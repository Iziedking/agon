import "dotenv/config";
import { config } from "../config/index.js";
import { broadcast, startWs } from "./ws.js";
import { startScheduler } from "./scheduler.js";
import { startAutopilot } from "./autopilot.js";
import { TxSender } from "./txSender.js";
import { runLiveContest } from "./runContest.js";
import { runContestById } from "./runContestById.js";

/// Coordinator: the WebSocket fanout, the Arc transaction sender, and the
/// self-driving contest autopilot. With a funded COORDINATOR_PRIVATE_KEY, the
/// autopilot opens, runs, and settles contests on a loop, so the whole platform
/// runs from one `docker compose up` with no per-contest commands. Without a key,
/// it stays in log-only mode. See ARCRUN_PLAN.md section 5.2.

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

  // The autopilot is the real driver: with a key set (and not turned off), it
  // opens, runs, and settles contests on a loop, no commands needed. Fall back to
  // the log-only scheduler stub when there is no key or autopilot is disabled.
  const autopilotOn = Boolean(config.coordinator.privateKey) && process.env.AUTOPILOT !== "0";
  if (autopilotOn) {
    void startAutopilot(broadcast).catch((err) => console.error("autopilot failed:", err));
    console.log("coordinator running (autopilot + ws). Ctrl+C to stop.");
  } else {
    if (!config.coordinator.privateKey) {
      console.log("autopilot off: set COORDINATOR_PRIVATE_KEY to open and settle contests automatically");
    } else {
      console.log("autopilot off: AUTOPILOT=0");
    }
    // Non-blocking, so a Redis hiccup never blocks the WS feed.
    void startScheduler((contestType) => {
      console.log(`scheduler: open ${contestType} contest (stub)`);
      broadcast({ type: "contest_open_intent", contestType, at: Date.now() });
    }).catch((err) => console.error("scheduler failed (is Redis up?):", err));
    console.log("coordinator running (scheduler + ws). Ctrl+C to stop.");
  }
}

main().catch((err) => {
  console.error("coordinator failed:", err);
  process.exit(1);
});
