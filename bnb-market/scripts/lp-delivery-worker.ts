import { recordLpWorkerHeartbeat, runLpDeliveryOnce, workerIntervalMs } from "../src/shared/server/lp-delivery.ts";

const stop = new AbortController();
process.once("SIGTERM", () => stop.abort());
process.once("SIGINT", () => stop.abort());

while (!stop.signal.aborted) {
  try {
    const result = await runLpDeliveryOnce();
    await recordLpWorkerHeartbeat(result);
    console.log(JSON.stringify({ event: "agon_lp_delivery_worker_heartbeat", status: result.status, jobId: result.jobId ?? null }));
  } catch (error) {
    const message = error instanceof Error ? error.message.replace(/\S+:\/\/\S+/g, "<redacted>").slice(0, 500) : "worker_error";
    console.error(JSON.stringify({ event: "agon_lp_delivery_worker_error", error: message }));
    try { await recordLpWorkerHeartbeat({ status: "failed", error: message }); } catch { console.error(JSON.stringify({ event: "agon_lp_delivery_heartbeat_failed" })); }
  }
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, workerIntervalMs(process.env.BNB_LP_AGENT_WORKER_INTERVAL_MS));
    stop.signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}
