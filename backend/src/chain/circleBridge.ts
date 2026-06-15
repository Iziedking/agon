import { AppKit } from "@circle-fin/app-kit";
import { createCircleWalletsAdapter } from "@circle-fin/adapter-circle-wallets";
import { config } from "../config/index.js";

/// Server-side bridge runner for Circle Dev-Controlled wallets. Lets an email
/// user move USDC off Arc into any chain Circle's CCTP V2 supports, using
/// their backend-managed wallet as the signer. Forwarder Service is on by
/// default so the user never needs a wallet on the destination chain.
///
/// Why this lives here and not in /wallet/execute: kit.bridge() orchestrates
/// approve + burn + attest + mint in one call. /wallet/execute is single-tx.
/// Mixing them would put a multi-step state machine inside a single-tx
/// endpoint, which is the wrong shape.
///
/// SCA caveat: Circle Dev-Controlled SCA wallets sign through Circle's
/// bundler, and the App Kit Circle Wallets adapter handles the
/// allowanceStrategy="approve" fallback CCTPv2 needs (the SCA cannot use
/// USDC's ecrecover-based permit). Each Circle wallet exists on a single
/// chain, so we provision one per source chain on demand.

export interface CircleBridgeParams {
  /// App Kit chain name for the SOURCE chain (e.g. "Arc_Testnet"). The wallet
  /// must already exist on this chain. Provisioning per source chain is the
  /// responsibility of the caller (typically /wallet/bridge after looking up
  /// the user's session).
  sourceChain: string;
  /// The user's Circle wallet ADDRESS on the source chain. The Circle Wallets
  /// adapter resolves which dev-controlled wallet signs from this address
  /// (addressContext: "developer-controlled"), so this MUST be the per-user
  /// wallet on `sourceChain`. Without it the adapter has no wallet to sign with.
  fromAddress: `0x${string}`;
  /// App Kit chain name for the DESTINATION chain.
  destChain: string;
  /// USDC amount as a decimal string (e.g. "1.50"). The SDK formats this
  /// against USDC's 6 decimals internally.
  amount: string;
  /// Recipient address on the destination chain. Pass the same as the source
  /// wallet's owner to "withdraw to self".
  recipientAddress: `0x${string}`;
}

export interface CircleBridgeResult {
  state: string;
  steps: Array<{
    name: string;
    state: string;
    txHash?: string;
    explorerUrl?: string;
  }>;
}

/// Runs a CCTPv2 bridge from a Circle Dev-Controlled wallet to another chain.
/// Returns the same shape the frontend uses to render the step strip so the
/// UI can light up approve / burn / attest / mint in real time.
export async function circleBridge(params: CircleBridgeParams): Promise<CircleBridgeResult> {
  const { apiKey, entitySecret } = config.circle;
  if (!apiKey || !entitySecret) {
    throw new Error("Circle Dev-Controlled wallets are not configured on this server.");
  }

  const adapter = createCircleWalletsAdapter({
    apiKey,
    entitySecret,
  } as never);

  const kit = new AppKit();

  const result = await kit.bridge({
    // `address` binds the adapter to the user's dev-controlled wallet on the
    // source chain; the Circle Wallets adapter signs from exactly this wallet.
    // The public app-kit `from` type omits `address` (it's a Circle-Wallets
    // adapter extension), so cast the whole object — same escape hatch the
    // chain-string casts already use.
    from: { adapter, chain: params.sourceChain, address: params.fromAddress } as never,
    to: {
      // Without a destination adapter the SDK uses the recipient address +
      // forwarder, which is exactly what we want for the email-user
      // withdraw flow.
      recipientAddress: params.recipientAddress,
      chain: params.destChain as never,
      useForwarder: true,
    },
    amount: params.amount,
  });

  const r = result as {
    state?: string;
    steps?: Array<{ name?: string; state?: string; txHash?: string; explorerUrl?: string }>;
  };
  return {
    state: r.state ?? "unknown",
    steps: (r.steps ?? []).map((s) => ({
      name: String(s.name ?? ""),
      state: String(s.state ?? ""),
      txHash: s.txHash,
      explorerUrl: s.explorerUrl,
    })),
  };
}
