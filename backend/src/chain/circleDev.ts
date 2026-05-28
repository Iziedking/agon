import {
  initiateDeveloperControlledWalletsClient,
  type CreateContractExecutionTransactionInput,
} from "@circle-fin/developer-controlled-wallets";
import { config } from "../config/index.js";

/// Backend integration with Circle Developer-Controlled Wallets. ArcRun email
/// users sign in with an email, the backend mints a Circle wallet for them,
/// and every on-chain write (ENTER / JOIN / CLAIM / mint / train) is executed
/// by Circle on the user's behalf. The user never touches a private key, the
/// passkey ceremony, or a wallet extension.
///
/// The custody trade-off is recorded in the project memory; this module is
/// the seam between ArcRun and that trade-off so a future swap to user-
/// controlled (MPC) wallets only has to replace this file.

let cachedClient: ReturnType<typeof initiateDeveloperControlledWalletsClient> | null = null;

function getClient() {
  if (cachedClient) return cachedClient;
  const { apiKey, entitySecret } = config.circle;
  if (!apiKey || !entitySecret) {
    throw new Error(
      "Circle Dev-Controlled wallets are not configured. Set CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET. " +
        "Run scripts/circle-bootstrap.ts once to register the entity secret and create a wallet set.",
    );
  }
  cachedClient = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
  return cachedClient;
}

export function circleDevConfigured(): boolean {
  return Boolean(config.circle.apiKey && config.circle.entitySecret && config.circle.walletSetId);
}

/// Mints a new wallet for `userRef` (we pass the email so future Circle
/// console lookups by refId are searchable). Returns the wallet id and EVM
/// address.
export async function createUserWallet(userRef: string): Promise<{
  walletId: string;
  address: `0x${string}`;
}> {
  const walletSetId = config.circle.walletSetId;
  if (!walletSetId) throw new Error("CIRCLE_WALLET_SET_ID is not set. Run scripts/circle-bootstrap.ts first.");

  const client = getClient();
  const res = await client.createWallets({
    blockchains: [config.circle.blockchain] as unknown as ["ARC-TESTNET"],
    count: 1,
    walletSetId,
    metadata: [{ refId: userRef }],
  });
  const wallet = res.data?.wallets?.[0];
  if (!wallet?.id || !wallet.address) {
    throw new Error("Circle createWallets returned no wallet");
  }
  return {
    walletId: wallet.id,
    address: wallet.address.toLowerCase() as `0x${string}`,
  };
}

/// Seeds a new wallet with testnet USDC from Circle's faucet so the operator
/// can immediately stake into a contest. Called after `createUserWallet`.
/// Best-effort: if the faucet refuses or is rate-limited we still return the
/// wallet to the user; they can request USDC themselves through the Arc
/// faucet flow.
export async function seedTestnetUsdc(address: `0x${string}`): Promise<{ requested: boolean }> {
  if (!config.circle.autoSeedUsdc) return { requested: false };
  const client = getClient();
  try {
    await client.requestTestnetTokens({
      address,
      blockchain: config.circle.blockchain as "ARC-TESTNET",
      usdc: true,
      native: false,
    });
    return { requested: true };
  } catch (err) {
    console.warn("[circleDev] testnet seed failed for", address, err);
    return { requested: false };
  }
}

export type ExecuteParams = {
  walletId: string;
  contractAddress: `0x${string}`;
  abiFunctionSignature: string;
  abiParameters: ReadonlyArray<string | number | boolean | string[]>;
  refId?: string;
  // The value transfer amount in human-decimal form (e.g. "0.01"). Most ArcRun
  // calls are pure ERC20 + custom contract calls with no native value, so this
  // stays undefined for the common path.
  amount?: string;
};

/// Submits a contract execution from `walletId`. Returns the Circle tx id and
/// initial state; the caller polls `getTxState` until COMPLETE / CONFIRMED or
/// FAILED. Always uses level-based MEDIUM fee since Arc gas is denominated in
/// USDC and stays small.
export async function executeContractCall(params: ExecuteParams): Promise<{
  id: string;
  state: string;
}> {
  const client = getClient();
  const input: CreateContractExecutionTransactionInput = {
    walletId: params.walletId,
    contractAddress: params.contractAddress,
    abiFunctionSignature: params.abiFunctionSignature,
    abiParameters: params.abiParameters as unknown as (string | number | boolean)[],
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
    ...(params.refId ? { refId: params.refId } : {}),
    ...(params.amount ? { amount: params.amount } : {}),
  };
  const res = await client.createContractExecutionTransaction(input);
  const data = res.data;
  if (!data?.id) throw new Error("Circle createContractExecutionTransaction returned no id");
  return { id: data.id, state: data.state };
}

/// Polls a single transaction by Circle's internal id. The on-chain tx hash
/// arrives once the transaction is broadcast; we surface both so the frontend
/// can link to arcscan as soon as it's available.
export async function getTxState(id: string): Promise<{
  state: string;
  txHash?: string | null;
  errorReason?: string | null;
}> {
  const client = getClient();
  const res = await client.getTransaction({ id });
  const tx = res.data?.transaction;
  if (!tx) throw new Error(`Circle transaction ${id} not found`);
  return {
    state: tx.state,
    txHash: tx.txHash ?? null,
    errorReason: tx.errorReason ?? null,
  };
}
