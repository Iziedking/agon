import "dotenv/config";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "../config/index.js";
import { broadcast, startWs } from "./ws.js";
import { defaultOpenHandler, startScheduler } from "./scheduler.js";
import { startAutopilot, startBackgroundServices } from "./autopilot.js";
import { TxSender } from "./txSender.js";
import { runLiveContest } from "./runContest.js";
import { runContestById } from "./runContestById.js";

/// Coordinator: the WebSocket fanout, the Arc transaction sender, the
/// contest open-driver, and the long-running background services
/// (sweepers, Arcana claimer, tick scheduler, random challenges).
///
/// Three open-driver modes, picked by env in this order:
///   1. SCHEDULER_MODE=cadence  — per-type BullMQ cron opens Scout/Analyst/Solver
///                                concurrently at their plan §5.2 cadences.
///                                Sweepers settle them when their windows close.
///   2. SCHEDULER_MODE=manual   — log-only stub; no auto-opens. Use this when
///                                you want to drive contests yourself via the
///                                npm run open-contest CLI.
///   3. (default)               — autopilot hot-loop: one rotating contest at
///                                a time, randomized pool + duration, friendly
///                                for demos. Same sweepers run underneath.
///
/// All three require COORDINATOR_PRIVATE_KEY (the sponsor that funds pools).
/// Without a key the coordinator stays in log-only mode regardless.

async function main() {
  startWs(config.coordinator.wsPort);

  let tx: TxSender | undefined;
  if (config.coordinator.privateKey) {
    tx = new TxSender(config.coordinator.privateKey);
    const [nonce, fees] = await Promise.all([tx.pendingNonce(), tx.fees()]);
    console.log(`coordinator wallet: ${tx.account.address}`);
    console.log(`  pending nonce: ${nonce}`);
    console.log(`  maxFeePerGas: ${fees.maxFeePerGas} maxPriorityFeePerGas: ${fees.maxPriorityFeePerGas}`);
  } else {
    console.log("no COORDINATOR_PRIVATE_KEY set; running in log-only mode (no on-chain sends)");
  }

  // ERC-8004 portable reputation. When a key is set, the validator
  // wallet posts giveFeedback to the on-chain ReputationRegistry at
  // settle time so other Arc apps can read a player's standing. Must
  // be a distinct address from the coordinator (no-self-feedback rule).
  if (config.validator.privateKey) {
    const v = privateKeyToAccount(config.validator.privateKey);
    const coordAddr = tx?.account.address.toLowerCase();
    if (coordAddr && v.address.toLowerCase() === coordAddr) {
      console.warn(
        `validator wallet: ${v.address} — SAME ADDRESS AS COORDINATOR. ERC-8004 self-feedback is rejected on-chain; use a distinct key.`,
      );
    } else {
      console.log(`validator wallet: ${v.address} (ERC-8004 feedback enabled)`);
    }
  } else {
    console.log("no VALIDATOR_PRIVATE_KEY set; ERC-8004 feedback disabled (in-game scoring still works)");
  }

  // Run a full contest on-chain and stream it to the live panel first, so it
  // never depends on the scheduler or Redis. Off by default; set RUN_CONTEST=1.
  if (process.env.RUN_CONTEST === "1") {
    console.log("RUN_CONTEST set: running one live contest end to end...");
    void runLiveContest(broadcast)
      .then(() => console.log("live contest done"))
      .catch((err) => console.error("live contest failed:", err));
  }

  // Run a real, already-open contest by id: stream the real field over the
  // window, then run the right runner over everyone and settle. Needs the
  // indexer running (it supplies the entries). Set RUN_CONTEST_ID=<id>.
  if (process.env.RUN_CONTEST_ID) {
    const id = Number(process.env.RUN_CONTEST_ID);
    console.log(`RUN_CONTEST_ID set: running contest ${id}...`);
    void runContestById(id, broadcast)
      .then(() => console.log(`contest ${id} run done`))
      .catch((err) => console.error(`contest ${id} run failed:`, err));
  }

  const mode = (process.env.SCHEDULER_MODE ?? "autopilot").toLowerCase();
  const haveKey = Boolean(config.coordinator.privateKey);

  if (mode === "cadence" && haveKey) {
    console.log("scheduler: cadence mode on (Scout 48h / Analyst 5m / Solver 7m)");
    // Background sweepers + Arcana + ticks still run; they're the same
    // services autopilot uses, just without its single-contest hot-loop.
    await startBackgroundServices(broadcast);
    void startScheduler((type) => defaultOpenHandler(type, broadcast)).catch((err) =>
      console.error("scheduler failed (is Redis up?):", err),
    );
    console.log("coordinator running (cadence scheduler + sweepers + ws). Ctrl+C to stop.");
    return;
  }

  if (mode === "manual" || !haveKey) {
    if (!haveKey) {
      console.log("autopilot off: set COORDINATOR_PRIVATE_KEY to open and settle contests automatically");
    } else {
      console.log("scheduler: manual mode (log-only; drive contests yourself)");
    }
    // Background sweepers still run so any contests opened manually get settled.
    if (haveKey) await startBackgroundServices(broadcast);
    void startScheduler((contestType) => {
      console.log(`scheduler: open ${contestType} contest (stub)`);
      broadcast({ type: "contest_open_intent", contestType, at: Date.now() });
    }).catch((err) => console.error("scheduler failed (is Redis up?):", err));
    console.log("coordinator running (manual scheduler + ws). Ctrl+C to stop.");
    return;
  }

  // Default: autopilot hot-loop (single rotating contest, demo-friendly).
  // Honors AUTOPILOT=0 to fall back to manual.
  if (process.env.AUTOPILOT === "0") {
    console.log("autopilot off: AUTOPILOT=0, falling back to manual mode");
    await startBackgroundServices(broadcast);
    void startScheduler((contestType) => {
      console.log(`scheduler: open ${contestType} contest (stub)`);
      broadcast({ type: "contest_open_intent", contestType, at: Date.now() });
    }).catch((err) => console.error("scheduler failed (is Redis up?):", err));
    console.log("coordinator running (manual scheduler + ws). Ctrl+C to stop.");
    return;
  }

  void startAutopilot(broadcast).catch((err) => console.error("autopilot failed:", err));
  console.log("coordinator running (autopilot + ws). Ctrl+C to stop.");
}

main().catch((err) => {
  console.error("coordinator failed:", err);
  process.exit(1);
});
