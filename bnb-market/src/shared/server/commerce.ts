import { decodeEventLog, erc20Abi, formatUnits, isAddress, parseAbi, type Address, type Hex } from "viem";
import { agentDetail } from "./catalog.ts";
import { checkedClient, networkConfig } from "./network.ts";
import { HttpError, object, publicJson } from "./http.ts";
import { contractBlockers, exactTokenAmount, jobState, providerBlockers, receiptJobId, sameAddress } from "./commerce-core.ts";
import { parseAgentId, type BnbChain, type CommerceReadiness } from "../types.ts";

// @bnbagent/sdk 0.5.5 dist/chunk-5XYQEBM2.js ABIs and
// github.com/bnb-chain/apex-contracts/contracts/OptimisticPolicy.sol, read 2026-09-04.
// No wallet/provider executor is constructed in this module. All calls are reads.
export const COMMERCE_READ_ABI = parseAbi([
  "function commerce() view returns (address)",
  "function router() view returns (address)",
  "function policyWhitelist(address policy) view returns (bool)",
  "function paused() view returns (bool)",
  "function disputeWindow() view returns (uint64)",
  "function voteQuorum() view returns (uint16)",
  "function activeVoterCount() view returns (uint16)",
  "function paymentToken() view returns (address)",
  "function jobPolicy(uint256 jobId) view returns (address)",
  "function getJob(uint256 jobId) view returns ((uint256 id,address client,address provider,address evaluator,string description,uint256 budget,uint256 expiredAt,uint8 status,address hook,uint256 submittedAt,bytes32 deliverable))",
]);
export const COMMERCE_EVENTS = parseAbi([
  "event JobCreated(uint256 indexed jobId,address indexed client,address indexed provider,address evaluator,uint256 expiredAt,address hook)",
  "event JobFunded(uint256 indexed jobId,address indexed client,address indexed provider,uint256 amount)",
  "event JobCompleted(uint256 indexed jobId,address indexed evaluator,bytes32 reason)",
  "event JobRejected(uint256 indexed jobId,address indexed rejector,bytes32 reason)",
  "event JobExpired(uint256 indexed jobId)",
  "event JobSubmitted(uint256 indexed jobId,address indexed provider,bytes32 deliverable)",
  "event PaymentReleased(uint256 indexed jobId,address indexed provider,uint256 amount)",
  "event Refunded(uint256 indexed jobId,address indexed client,uint256 amount)",
]);

export function decodeCommerceEvents(logs: { address: Address; data: Hex; topics: readonly Hex[] }[], commerce: Address) {
  const events: { address: Address; jobId: bigint; event: string; amountRaw?: string }[] = [];
  for (const log of logs) {
    if (!sameAddress(log.address, commerce) || log.topics.length === 0) continue;
    try {
      const decoded = decodeEventLog({ abi: COMMERCE_EVENTS, data: log.data, topics: [log.topics[0], ...log.topics.slice(1)] });
      events.push({ address: log.address, jobId: decoded.args.jobId, event: decoded.eventName,
        ...("amount" in decoded.args ? { amountRaw: decoded.args.amount.toString() } : {}) });
    } catch { /* Unrelated logs, including token approvals, are not job receipts. */ }
  }
  return events;
}

export async function commerceSnapshot(chainId: BnbChain) {
  const client = await checkedClient(chainId);
  const block = await client.getBlock();
  const blockNumber = block.number;
  const c = networkConfig(chainId).contracts;
  const abi = COMMERCE_READ_ABI;
  const [codes, routerCommerce, policyCommerce, policyRouter, whitelisted, routerPaused, commercePaused, token, disputeWindow, quorum, voters] = await Promise.all([
    Promise.all([c.commerceProxy, c.routerProxy, c.policy, c.paymentToken].map((address) => client.getCode({ address, blockNumber }))),
    client.readContract({ address: c.routerProxy, abi, functionName: "commerce", blockNumber }),
    client.readContract({ address: c.policy, abi, functionName: "commerce", blockNumber }),
    client.readContract({ address: c.policy, abi, functionName: "router", blockNumber }),
    client.readContract({ address: c.routerProxy, abi, functionName: "policyWhitelist", args: [c.policy], blockNumber }),
    client.readContract({ address: c.routerProxy, abi, functionName: "paused", blockNumber }),
    client.readContract({ address: c.commerceProxy, abi, functionName: "paused", blockNumber }),
    client.readContract({ address: c.commerceProxy, abi, functionName: "paymentToken", blockNumber }),
    client.readContract({ address: c.policy, abi, functionName: "disputeWindow", blockNumber }),
    client.readContract({ address: c.policy, abi, functionName: "voteQuorum", blockNumber }),
    client.readContract({ address: c.policy, abi, functionName: "activeVoterCount", blockNumber }),
  ]);
  // Do not query a token nominated by an untrusted provider or unexpected kernel.
  if (!sameAddress(token, c.paymentToken)) throw new HttpError(409, "The commerce payment token differs from the pinned deployment.");
  const [decimals, symbol] = await Promise.all([
    client.readContract({ address: token, abi: erc20Abi, functionName: "decimals", blockNumber }),
    client.readContract({ address: token, abi: erc20Abi, functionName: "symbol", blockNumber }),
  ]);
  const blockers = contractBlockers({ codePresent: codes.every((code) => Boolean(code && code !== "0x")),
    bindingsMatch: sameAddress(routerCommerce, c.commerceProxy) && sameAddress(policyCommerce, c.commerceProxy) && sameAddress(policyRouter, c.routerProxy),
    whitelisted, paused: routerPaused || commercePaused, tokenMatches: true, disputeWindow: disputeWindow.toString(), quorum, voters });
  return { client, blockNumber, timestamp: block.timestamp, contracts: c, token: { address: token, decimals, symbol: symbol.slice(0, 30) }, disputeWindow: disputeWindow.toString(), blockers };
}

export async function commerceReadiness(chainId: BnbChain, agentId: string): Promise<CommerceReadiness> {
  const agent = await agentDetail(chainId, parseAgentId(agentId), true);
  const snapshot = await commerceSnapshot(chainId);
  const endpoint = agent.services.find((s) => s.name.toLowerCase() === "erc-8183" && new URL(s.endpoint).pathname.endsWith("/status"));
  const reasons = [...snapshot.blockers];
  if (agent.registrationMatches !== true || !agent.versionHash || agent.active === false) reasons.push("registration_not_qualified");
  let providerPolicy: string | null = null;
  let providerPolicyWhitelisted: boolean | null = null;
  let advertisedPrice: string | null = null;
  if (!endpoint) reasons.push("commerce_endpoint_missing");
  else {
    try {
      const card = object(await publicJson(endpoint.endpoint));
      if (typeof card.policy_address === "string" && isAddress(card.policy_address)) {
        providerPolicy = card.policy_address;
        providerPolicyWhitelisted = await snapshot.client.readContract({ address: snapshot.contracts.routerProxy, abi: COMMERCE_READ_ABI,
          functionName: "policyWhitelist", args: [card.policy_address], blockNumber: snapshot.blockNumber });
      }
      reasons.push(...providerBlockers(card, { commerce: snapshot.contracts.commerceProxy, router: snapshot.contracts.routerProxy,
        policy: snapshot.contracts.policy, token: snapshot.token.address, wallet: agent.wallet }, providerPolicyWhitelisted === true));
      advertisedPrice = exactTokenAmount(card.service_price);
      if (advertisedPrice === null) reasons.push("exact_price_required");
    } catch { reasons.push("provider_status_unavailable"); }
  }
  if (chainId === 56) reasons.push("mainnet_payments_disabled");
  // A healthy status document is never a signed quote, authorization or task proof.
  reasons.push("signed_quote_and_execution_not_enabled");
  return { chainId, agentId, versionHash: agent.versionHash, checkedAt: new Date().toISOString(), blockNumber: snapshot.blockNumber.toString(),
    status: "blocked", blockers: [...new Set(reasons)], contracts: { commerce: snapshot.contracts.commerceProxy, router: snapshot.contracts.routerProxy, policy: snapshot.contracts.policy },
    providerPolicy, providerPolicyWhitelisted, token: snapshot.token, disputeWindowSeconds: snapshot.disputeWindow,
    advertisedPriceRaw: advertisedPrice, advertisedPriceDisplay: advertisedPrice === null ? null : formatUnits(BigInt(advertisedPrice), snapshot.token.decimals),
    paymentsEnabled: false };
}

export async function readCommerceJob(chainId: BnbChain, jobId: string, blockNumber?: bigint) {
  const id = BigInt(parseAgentId(jobId));
  const client = await checkedClient(chainId);
  const block = await client.getBlock(blockNumber === undefined ? {} : { blockNumber });
  const c = networkConfig(chainId).contracts;
  const [job, policy] = await Promise.all([
    client.readContract({ address: c.commerceProxy, abi: COMMERCE_READ_ABI, functionName: "getJob", args: [id], blockNumber: block.number }),
    client.readContract({ address: c.routerProxy, abi: COMMERCE_READ_ABI, functionName: "jobPolicy", args: [id], blockNumber: block.number }),
  ]);
  if (job.id !== id || /^0x0{40}$/i.test(job.client)) throw new HttpError(404, "No job exists at that ID on the selected network.");
  if (!sameAddress(job.evaluator, c.routerProxy) || !sameAddress(job.hook, c.routerProxy)) throw new HttpError(409, "This job does not use the supported commerce router.");
  return { chainId, jobId, commerce: c.commerceProxy, policy, blockNumber: block.number.toString(), state: jobState(job.status),
    client: job.client, provider: job.provider, budgetRaw: job.budget.toString(), expiresAt: job.expiredAt.toString(),
    submittedAt: job.submittedAt.toString(), deliverableHash: job.deliverable,
    refundEligible: [1, 2].includes(job.status) && block.timestamp >= job.expiredAt,
    deliveryVerified: false, checkedAt: new Date().toISOString() };
}

export async function readCommerceReceipt(chainId: BnbChain, hash: string) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new HttpError(400, "Enter a valid transaction hash.");
  const client = await checkedClient(chainId);
  const receipt = await client.getTransactionReceipt({ hash: hash as Hex });
  const c = networkConfig(chainId).contracts;
  if (receipt.status !== "success") return { chainId, hash, state: "reverted", job: null };
  const events = decodeCommerceEvents(receipt.logs, c.commerceProxy);
  let jobId: string;
  try { jobId = receiptJobId(events, c.commerceProxy); }
  catch { throw new HttpError(409, "This receipt does not identify one supported BNB job. Approval alone is not payment or delivery."); }
  const job = await readCommerceJob(chainId, jobId, receipt.blockNumber);
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  if (block.hash !== receipt.blockHash) throw new HttpError(409, "Receipt changed during confirmation. Recheck before relying on it.");
  return { chainId, hash, state: "included", blockNumber: receipt.blockNumber.toString(), blockHash: receipt.blockHash,
    job, events: events.map(({ event, amountRaw }) => ({ event, amountRaw })),
    explorerUrl: `${networkConfig(chainId).explorer}/tx/${hash}`, deliveryVerified: false };
}
