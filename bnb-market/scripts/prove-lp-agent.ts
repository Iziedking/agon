import { inspectLpPosition } from "../src/shared/providers/pancake.ts";
import { parseLpInput } from "../src/shared/providers/lp-core.ts";
// Supply a real position NFT ID. Reads public chain state only; no signer.
const input = parseLpInput({ positionId: process.argv[2] ?? "1", halfWidthSteps: 10, maxDeviationTicks: 100 });
try {
  const result = await inspectLpPosition(97, input);
  console.log(JSON.stringify(result, null, 2));
  console.log("No payment, registration, trade or settlement occurred. This proves an LP analysis against the identified testnet block only.");
} catch (error) {
  console.error(JSON.stringify({ status: "unavailable", reason: error instanceof Error ? error.message.split("\n")[0] : "Read failed" }));
  process.exitCode = 1;
}
