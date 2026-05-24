import "dotenv/config";
import { config } from "../config/index.js";
import { broadcast, startWs } from "./ws.js";
import { startScheduler } from "./scheduler.js";
import { TxSender } from "./txSender.js";

/// Coordinator skeleton: the WebSocket fanout, the BullMQ contest scheduler, and
/// the Arc transaction sender. v0 opens are logged and fanned out rather than
/// sent on-chain; wiring the real listContest call comes with the treasury
/// funding flow. See ARCRUN_PLAN.md section 5.2.

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

  await startScheduler((contestType) => {
    console.log(`scheduler: open ${contestType} contest (stub)`);
    broadcast({ type: "contest_open_intent", contestType, at: Date.now() });
  });

  console.log("coordinator running (scheduler + ws). Ctrl+C to stop.");
}

main().catch((err) => {
  console.error("coordinator failed:", err);
  process.exit(1);
});
