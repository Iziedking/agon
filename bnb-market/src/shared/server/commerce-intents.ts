import { createHash } from "node:crypto";
import { AltanaWalletProvider } from "@bnbagent/sdk/wallets";
import { NegotiationHandler, buildJobDescription, verifyQuoteSignature } from "@bnbagent/sdk/erc8183";
import { formatUnits, getAddress, isAddress, type Address, type Hex } from "viem";
import { agentDetail } from "./catalog.ts";
import { commerceSnapshot, decodeCommerceEvents, COMMERCE_READ_ABI } from "./commerce.ts";
import { sameAddress } from "./commerce-core.ts";
import { database } from "./store.ts";
import { HttpError } from "./http.ts";
import { LP_AGENT_VERSION, parseLpInput, type LpInput } from "../providers/lp-core.ts";
import { jobExpiry, lpCommerceConfig, lpNegotiationRequest, parseCommerceIntentId,
  preparedTransaction, signedQuoteFields, LP_QUOTE_TTL_SECONDS } from "./commerce-intent-core.ts";
import type { CommerceIntent, CommerceIntentState, CommerceStep, LpHiringReadiness, PreparedCommerceTransaction } from "../types.ts";

type IntentRow = {
  id: string; chain_id: 97; buyer_address: Address; agent_id: string; provider_address: Address;
  service_version: string; registration_hash: string; input_json: string; request_hash: string;
  quote_json: string | null; quote_hash: Hex | null; description: string | null; amount_raw: string;
  token_address: Address; quote_expires_at: Date | null; job_expires_at: string | null;
  state: "quoting" | "quote_verified" | "open" | "registered" | "approved" | "funded" | "expired" | "reverted" | "needs_attention";
  job_id: string | null; last_error: string | null; created_at: Date; updated_at: Date;
};

type TransactionRow = { tx_hash: Hex; step: CommerceStep; status: "submitted" | "confirming" | "confirmed" | "reverted";
  block_number: string | null; confirmations: number; created_at: Date };

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const quoteHash = (value: string): Hex => `0x${sha256(value)}`;

function assertBnbTestnet(chainId: number): asserts chainId is 97 {
  if (chainId !== 97) throw new HttpError(409, "Paid LP Guardian hiring is available on BNB Testnet only. Mainnet remains read-only.");
}

function address(value: string): Address {
  if (!isAddress(value)) throw new HttpError(503, "A saved commerce address is invalid. Hiring remains disabled.");
  return getAddress(value);
}

function inputJson(value: unknown): { input: LpInput; json: string } {
  try { const input = parseLpInput(value); return { input, json: JSON.stringify(input) }; }
  catch (error) { throw new HttpError(400, error instanceof Error ? error.message : "Invalid LP Guardian settings."); }
}

async function providerReadiness(chainId: number): Promise<{ readiness: LpHiringReadiness; config?: ReturnType<typeof lpCommerceConfig> & { ready: true };
  snapshot?: Awaited<ReturnType<typeof commerceSnapshot>>; versionHash?: string }> {
  const configured = lpCommerceConfig(process.env);
  if (chainId !== 97) return { readiness: { chainId, status: "blocked", enabled: false, blockers: ["testnet_only"],
    agentId: configured.ready ? configured.config.agentId : null, providerAddress: configured.ready ? configured.config.providerAddress : null,
    token: null, priceRaw: configured.ready ? configured.config.priceRaw : null, priceDisplay: null, checkedAt: new Date().toISOString() } };
  if (!configured.ready) return { readiness: { chainId, status: "configuration_required", enabled: false, blockers: configured.blockers,
    agentId: null, providerAddress: null, token: null, priceRaw: null, priceDisplay: null, checkedAt: new Date().toISOString() } };
  const snapshot = await commerceSnapshot(97);
  const blockers = [...snapshot.blockers];
  let versionHash: string | undefined;
  try {
    const agent = await agentDetail(97, configured.config.agentId, true);
    versionHash = agent.versionHash ?? undefined;
    if (agent.registrationMatches !== true || agent.active === false || !agent.versionHash) blockers.push("registration_not_qualified");
    if (!sameAddress(agent.wallet, configured.config.providerAddress)) blockers.push("provider_wallet_mismatch");
    const configuredUrl = new URL(configured.config.publicUrl);
    const configuredPath = configuredUrl.pathname.replace(/\/+$/, "") || "/";
    const registered = agent.services.some((service) => {
      const endpoint = new URL(service.endpoint);
      const endpointPath = endpoint.pathname.replace(/\/+$/, "") || "/";
      return service.name.toLowerCase() === "erc-8183" && endpoint.origin === configuredUrl.origin &&
        endpointPath === configuredPath && !endpoint.search && !endpoint.hash;
    });
    if (!registered) blockers.push("provider_endpoint_mismatch");
  } catch { blockers.push("registration_unavailable"); }
  // Funding remains closed until the provider worker can verify the funded
  // quote, generate the report, publish its manifest and submit its hash.
  blockers.push("provider_execution_unavailable");
  return { readiness: { chainId, status: blockers.length ? "blocked" : "available", enabled: blockers.length === 0,
    blockers: [...new Set(blockers)], agentId: configured.config.agentId, providerAddress: configured.config.providerAddress,
    token: snapshot.token, priceRaw: configured.config.priceRaw,
    priceDisplay: formatUnits(BigInt(configured.config.priceRaw), snapshot.token.decimals), checkedAt: new Date().toISOString() },
    config: configured, snapshot, versionHash };
}

export async function lpHiringReadiness(chainId: number): Promise<LpHiringReadiness> {
  return (await providerReadiness(chainId)).readiness;
}

async function transactionFor(row: IntentRow): Promise<{ transaction: PreparedCommerceTransaction | null; state: CommerceIntentState; message: string }> {
  if (!row.quote_expires_at || !row.quote_json || !row.quote_hash || !row.description || !row.job_expires_at) return { transaction: null, state: "quoting", message: "The provider quote is being prepared." };
  if (row.state === "funded") return { transaction: null, state: "funded", message: "The quoted amount is held by the ERC-8183 commerce contract." };
  if (row.quote_expires_at.getTime() <= Date.now()) return { transaction: null, state: "expired", message: "This quote expired before funding. Start a new hire so price and authority can be checked again." };
  const snapshot = await commerceSnapshot(97);
  try {
    if (quoteHash(row.quote_json).toLowerCase() !== row.quote_hash.toLowerCase()) throw new Error("quote_record_hash_mismatch");
    const envelope = JSON.parse(row.quote_json) as Record<string, unknown>;
    signedQuoteFields(envelope, { priceRaw: row.amount_raw, token: address(row.token_address), commerce: snapshot.contracts.commerceProxy });
    if (buildJobDescription(envelope) !== row.description) throw new Error("job_description_mismatch");
    const registered = await agentDetail(97, row.agent_id, true);
    if (registered.versionHash !== row.registration_hash || !sameAddress(registered.wallet, row.provider_address)) throw new Error("provider_version_changed");
  } catch {
    return { transaction: null, state: "needs_attention", message: "The signed quote or registered provider version changed. Do not continue this intent." };
  }
  const base = { commerce: snapshot.contracts.commerceProxy, router: snapshot.contracts.routerProxy, policy: snapshot.contracts.policy,
    token: address(row.token_address), provider: address(row.provider_address), amount: BigInt(row.amount_raw), description: row.description,
    expiredAt: BigInt(row.job_expires_at) };
  if (!row.job_id) return { transaction: preparedTransaction("create", base), state: "create_prepared", message: "Review the signed quote, then create its open job." };
  const jobId = BigInt(row.job_id);
  const [job, policy, allowance] = await Promise.all([
    snapshot.client.readContract({ address: snapshot.contracts.commerceProxy, abi: COMMERCE_READ_ABI, functionName: "getJob", args: [jobId] }),
    snapshot.client.readContract({ address: snapshot.contracts.routerProxy, abi: COMMERCE_READ_ABI, functionName: "jobPolicy", args: [jobId] }),
    snapshot.client.readContract({ address: snapshot.token.address, abi: [{ type: "function", name: "allowance", stateMutability: "view", inputs: [{name:"owner",type:"address"},{name:"spender",type:"address"}], outputs: [{name:"",type:"uint256"}] }] as const,
      functionName: "allowance", args: [address(row.buyer_address), snapshot.contracts.commerceProxy] }),
  ]);
  if (!sameAddress(job.client, row.buyer_address) || !sameAddress(job.provider, row.provider_address) ||
      !sameAddress(job.evaluator, snapshot.contracts.routerProxy) || !sameAddress(job.hook, snapshot.contracts.routerProxy) ||
      job.description !== row.description || job.expiredAt.toString() !== row.job_expires_at) {
    return { transaction: null, state: "needs_attention", message: "The onchain job no longer matches the signed AGON intent. Do not fund it." };
  }
  if (job.status === 1 && job.budget === BigInt(row.amount_raw)) return { transaction: null, state: "funded", message: "The quoted amount is held by the ERC-8183 commerce contract." };
  if (job.status !== 0) return { transaction: null, state: "needs_attention", message: "This job is no longer open and its current state cannot be funded from this intent." };
  if (!sameAddress(policy, snapshot.contracts.policy)) return { transaction: preparedTransaction("register", { ...base, jobId }), state: "register_prepared", message: "Bind the supported settlement policy before granting token access." };
  if (allowance < BigInt(row.amount_raw)) return { transaction: preparedTransaction("approve", { ...base, jobId }), state: "approve_prepared", message: "Approve only the exact quoted amount for this commerce contract." };
  return { transaction: preparedTransaction("fund", { ...base, jobId }), state: "fund_prepared", message: "The next approval moves the quoted token amount into the protected job." };
}

async function latestTransaction(intentId: string): Promise<TransactionRow | null> {
  const result = await (await database()).query<TransactionRow>("SELECT tx_hash,step,status,block_number,confirmations,created_at FROM bnb_commerce_transactions WHERE intent_id=$1 ORDER BY created_at DESC LIMIT 1", [intentId]);
  return result.rows[0] ?? null;
}

async function view(row: IntentRow): Promise<CommerceIntent> {
  const next = await transactionFor(row);
  const tx = await latestTransaction(row.id);
  const effectiveState = tx?.status === "confirming" || tx?.status === "submitted" ? `${tx.step}_confirming` as CommerceIntentState : next.state;
  const token = address(row.token_address);
  const snapshot = await commerceSnapshot(97);
  return { id: row.id, chainId: 97, buyerAddress: address(row.buyer_address), agentId: row.agent_id,
    providerAddress: address(row.provider_address), serviceVersion: row.service_version, registrationHash: row.registration_hash, state: effectiveState,
    amountRaw: row.amount_raw, amountDisplay: formatUnits(BigInt(row.amount_raw), snapshot.token.decimals),
    token: { address: token, decimals: snapshot.token.decimals, symbol: snapshot.token.symbol },
    quoteHash: (row.quote_hash ?? `0x${"0".repeat(64)}`) as Hex,
    quoteExpiresAt: row.quote_expires_at?.toISOString() ?? new Date(0).toISOString(),
    jobExpiresAt: row.job_expires_at ? new Date(Number(BigInt(row.job_expires_at)) * 1000).toISOString() : new Date(0).toISOString(),
    jobId: row.job_id, transaction: tx?.status === "confirming" || tx?.status === "submitted" ? null : next.transaction,
    transactionHash: tx?.tx_hash ?? null, confirmations: tx?.confirmations ?? 0, message: tx?.status === "confirming" || tx?.status === "submitted" ? "The wallet transaction is submitted. AGON is waiting for two confirmations." : next.message,
    updatedAt: row.updated_at.toISOString() };
}

async function readIntentRow(id: string, buyer: string): Promise<IntentRow> {
  const result = await (await database()).query<IntentRow>("SELECT * FROM bnb_commerce_intents WHERE id=$1 AND buyer_address=$2", [parseCommerceIntentId(id), buyer.toLowerCase()]);
  if (!result.rows[0]) throw new HttpError(404, "This hiring intent was not found for the signed-in wallet.");
  return result.rows[0];
}

export async function readLpHireIntent(chainId: number, buyer: string, id: string): Promise<CommerceIntent> {
  assertBnbTestnet(chainId);
  return view(await readIntentRow(id, buyer));
}

export async function prepareLpHireIntent(chainId: number, buyer: string, rawId: unknown, rawInput: unknown): Promise<CommerceIntent> {
  assertBnbTestnet(chainId);
  const id = parseCommerceIntentId(rawId);
  const parsed = inputJson(rawInput);
  const available = await providerReadiness(chainId);
  if (!available.config || !available.snapshot || !available.versionHash || !available.readiness.enabled) {
    throw new HttpError(503, `Paid hiring is not ready: ${available.readiness.blockers.join(", ") || "provider configuration unavailable"}.`);
  }
  const config = available.config.config;
  const requestData = lpNegotiationRequest(id, parsed.input, { serviceVersion: LP_AGENT_VERSION, registrationHash: available.versionHash }).request;
  const requestJson = JSON.stringify(requestData);
  const requestHash = sha256(requestJson);
  const db = await database();
  const connection = await db.connect();
  try {
    await connection.query("BEGIN");
    await connection.query("SELECT pg_advisory_xact_lock(9708183,1)");
    const prior = await connection.query<IntentRow>("SELECT * FROM bnb_commerce_intents WHERE id=$1", [id]);
    if (prior.rows[0]) {
      if (prior.rows[0].buyer_address.toLowerCase() !== buyer.toLowerCase() || prior.rows[0].input_json !== parsed.json || prior.rows[0].request_hash !== requestHash) {
        throw new HttpError(409, "This intent ID already belongs to a different wallet or request.");
      }
      await connection.query("COMMIT");
      if (prior.rows[0].state !== "quoting") return view(prior.rows[0]);
    } else {
      const count = await connection.query<{ total: string }>("SELECT count(*) AS total FROM bnb_commerce_intents WHERE created_at >= (date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')");
      if (Number(count.rows[0].total) >= config.dailyIntentLimit) throw new HttpError(429, "Today's LP Guardian hiring allowance is used. Try again after 00:00 UTC.");
      await connection.query(`INSERT INTO bnb_commerce_intents(id,chain_id,buyer_address,agent_id,provider_address,service_version,registration_hash,input_json,request_hash,amount_raw,token_address,state)
        VALUES($1,97,$2,$3,$4,$5,$6,$7,$8,$9,$10,'quoting')`, [id, buyer.toLowerCase(), config.agentId, config.providerAddress.toLowerCase(), LP_AGENT_VERSION, available.versionHash, parsed.json, requestHash, config.priceRaw, available.snapshot.token.address.toLowerCase()]);
      await connection.query("COMMIT");
    }
  } catch (error) { await connection.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { connection.release(); }

  try {
    // @bnbagent/sdk 0.5.5 wallets/sessionQuoteSigner and negotiation types,
    // verified from the installed dist source on 2026-09-04. The Altana peer
    // is pinned to 0.7.1. No generic message or transaction signer is exposed.
    const wallet = await AltanaWalletProvider.sessionFromEnv({ network: "bnb-testnet" });
    if (!sameAddress(wallet.address, config.providerAddress)) throw new Error("The Altana session belongs to a different provider wallet.");
    const handler = new NegotiationHandler({ servicePrice: config.priceRaw, currency: available.snapshot.token.address,
      estimatedCompletionSeconds: 120, requireQualityStandards: true, quoteSigner: wallet.sessionQuoteSigner(),
      quoteTtlSeconds: LP_QUOTE_TTL_SECONDS, chainId: 97, verifyingContract: available.snapshot.contracts.commerceProxy });
    const result = await handler.negotiate(requestData);
    const envelope = result.toDict();
    const fields = signedQuoteFields(envelope, { priceRaw: config.priceRaw, token: available.snapshot.token.address, commerce: available.snapshot.contracts.commerceProxy });
    const verdict = await verifyQuoteSignature({ envelope, provider: config.providerAddress, publicClient: available.snapshot.client,
      expectedVerifyingContract: available.snapshot.contracts.commerceProxy });
    if (!verdict.valid) throw new Error(`The provider signature was rejected: ${verdict.reason}`);
    const description = buildJobDescription(envelope);
    const expiresAt = jobExpiry(available.snapshot.timestamp, available.snapshot.disputeWindow);
    const serialized = JSON.stringify(envelope);
    const saved = await db.query<IntentRow>(`UPDATE bnb_commerce_intents SET quote_json=$2,quote_hash=$3,description=$4,
      quote_expires_at=to_timestamp($5),job_expires_at=$6,state='quote_verified',updated_at=now(),last_error=NULL
      WHERE id=$1 AND state='quoting' RETURNING *`, [id, serialized, quoteHash(serialized), description, fields.quoteExpiresAt, expiresAt.toString()]);
    if (!saved.rows[0]) return view(await readIntentRow(id, buyer));
    return view(saved.rows[0]);
  } catch (error) {
    const message = error instanceof Error ? error.message.replace(/\S+:\/\/\S+/g, "<redacted>").slice(0, 500) : "Provider quote failed.";
    await db.query("UPDATE bnb_commerce_intents SET state='needs_attention',last_error=$2,updated_at=now() WHERE id=$1 AND state='quoting'", [id, message]);
    console.error(JSON.stringify({ event: "agon_lp_quote_failed", intentId: id, chainId: 97 }));
    throw new HttpError(503, "The provider could not produce a verifiable signed quote. No wallet action was prepared.");
  }
}

export async function reconcileLpHireTransaction(chainId: number, buyer: string, id: string, rawStep: unknown, rawHash: unknown): Promise<CommerceIntent> {
  assertBnbTestnet(chainId);
  const step = rawStep;
  if (!(["create", "register", "approve", "fund"] as unknown[]).includes(step)) throw new HttpError(400, "Choose a valid commerce step.");
  if (typeof rawHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(rawHash)) throw new HttpError(400, "Enter a valid BNB Testnet transaction hash.");
  const hash = rawHash.toLowerCase() as Hex;
  const row = await readIntentRow(id, buyer);
  const expected = await transactionFor(row);
  if (!expected.transaction || expected.transaction.step !== step) throw new HttpError(409, "This transaction is not the next action for the current hiring intent.");
  const db = await database();
  await db.query(`INSERT INTO bnb_commerce_transactions(tx_hash,intent_id,step,status)
    VALUES($1,$2,$3,'submitted') ON CONFLICT DO NOTHING`, [hash, row.id, step]);
  const claims = await db.query<{ tx_hash: Hex; intent_id: string; step: CommerceStep }>(
    "SELECT tx_hash,intent_id,step FROM bnb_commerce_transactions WHERE tx_hash=$1 OR (intent_id=$2 AND step=$3)", [hash, row.id, step]);
  const claimed = claims.rows.find((claim) => claim.tx_hash.toLowerCase() === hash && claim.intent_id === row.id && claim.step === step);
  if (!claimed || claims.rows.length !== 1) throw new HttpError(409, "This intent step or transaction hash is already bound to another commerce action.");
  const snapshot = await commerceSnapshot(97);
  let transaction;
  let receipt;
  try {
    [transaction, receipt] = await Promise.all([snapshot.client.getTransaction({ hash }), snapshot.client.getTransactionReceipt({ hash })]);
  } catch {
    await db.query("UPDATE bnb_commerce_transactions SET status='confirming',checked_at=now() WHERE tx_hash=$1", [hash]);
    return view(await readIntentRow(id, buyer));
  }
  if (!sameAddress(transaction.from, buyer) || !transaction.to || !sameAddress(transaction.to, expected.transaction.to) ||
      transaction.input.toLowerCase() !== expected.transaction.data.toLowerCase() || transaction.value !== 0n) {
    await db.query("UPDATE bnb_commerce_transactions SET status='reverted',checked_at=now() WHERE tx_hash=$1", [hash]);
    await db.query("UPDATE bnb_commerce_intents SET state='needs_attention',last_error='transaction_mismatch',updated_at=now() WHERE id=$1", [row.id]);
    throw new HttpError(409, "The wallet transaction does not match the reviewed AGON action. Do not continue this intent.");
  }
  if (receipt.status !== "success") {
    await db.query("UPDATE bnb_commerce_transactions SET status='reverted',block_number=$2,block_hash=$3,checked_at=now() WHERE tx_hash=$1", [hash, receipt.blockNumber.toString(), receipt.blockHash]);
    await db.query("UPDATE bnb_commerce_intents SET state='reverted',last_error='transaction_reverted',updated_at=now() WHERE id=$1", [row.id]);
    return view(await readIntentRow(id, buyer));
  }
  const head = await snapshot.client.getBlockNumber();
  const confirmations = Number(head - receipt.blockNumber + 1n);
  if (confirmations < 2) {
    await db.query("UPDATE bnb_commerce_transactions SET status='confirming',block_number=$2,block_hash=$3,confirmations=$4,checked_at=now() WHERE tx_hash=$1", [hash, receipt.blockNumber.toString(), receipt.blockHash, confirmations]);
    return view(await readIntentRow(id, buyer));
  }
  let jobId = row.job_id;
  if (step === "create") {
    const created = decodeCommerceEvents(receipt.logs, snapshot.contracts.commerceProxy).filter((event) => event.event === "JobCreated");
    const ids = new Set(created.map((event) => event.jobId.toString()));
    if (ids.size !== 1) throw new HttpError(409, "The confirmed transaction did not create exactly one supported commerce job.");
    jobId = [...ids][0];
  }
  if (!jobId) throw new HttpError(409, "A confirmed job ID is required before continuing.");
  const job = await snapshot.client.readContract({ address: snapshot.contracts.commerceProxy, abi: COMMERCE_READ_ABI, functionName: "getJob", args: [BigInt(jobId)] });
  const policy = await snapshot.client.readContract({ address: snapshot.contracts.routerProxy, abi: COMMERCE_READ_ABI, functionName: "jobPolicy", args: [BigInt(jobId)] });
  if (!sameAddress(job.client, buyer) || !sameAddress(job.provider, row.provider_address) ||
      !sameAddress(job.evaluator, snapshot.contracts.routerProxy) || !sameAddress(job.hook, snapshot.contracts.routerProxy) ||
      job.description !== row.description || job.expiredAt.toString() !== row.job_expires_at) {
    throw new HttpError(409, "The confirmed job differs from the signed hiring intent.");
  }
  let state: IntentRow["state"] = "open";
  if (step === "register") {
    if (!sameAddress(policy, snapshot.contracts.policy)) throw new HttpError(409, "The confirmed job is not bound to the supported settlement policy.");
    state = "registered";
  } else if (step === "approve") {
    const allowance = await snapshot.client.readContract({ address: snapshot.token.address,
      abi: [{ type: "function", name: "allowance", stateMutability: "view", inputs: [{name:"owner",type:"address"},{name:"spender",type:"address"}], outputs: [{name:"",type:"uint256"}] }] as const,
      functionName: "allowance", args: [address(buyer), snapshot.contracts.commerceProxy] });
    if (allowance < BigInt(row.amount_raw)) throw new HttpError(409, "The confirmed approval is below the exact quoted amount.");
    state = "approved";
  } else if (step === "fund") {
    const funded = decodeCommerceEvents(receipt.logs, snapshot.contracts.commerceProxy).find((event) => event.event === "JobFunded" && event.jobId.toString() === jobId);
    if (!funded || funded.amountRaw !== row.amount_raw || job.status !== 1 || job.budget.toString() !== row.amount_raw) throw new HttpError(409, "Funding could not be reconciled to the exact quoted job amount.");
    state = "funded";
  }
  await db.query("UPDATE bnb_commerce_transactions SET status='confirmed',block_number=$2,block_hash=$3,confirmations=$4,checked_at=now() WHERE tx_hash=$1", [hash, receipt.blockNumber.toString(), receipt.blockHash, confirmations]);
  await db.query("UPDATE bnb_commerce_intents SET state=$2,job_id=$3,last_error=NULL,updated_at=now() WHERE id=$1", [row.id, state, jobId]);
  return view(await readIntentRow(id, buyer));
}
