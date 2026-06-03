/// Maps raw wallet, viem, and Circle errors to short, friendly messages.
/// Returns the friendly version; callers can also surface the raw detail
/// alongside via `rawErrorDetail(e)` when they want a diagnostic line.
export function friendlyError(e: unknown, fallback = "something went wrong. try again."): string {
  const msg = (e instanceof Error ? e.message : String(e ?? "")).toLowerCase();

  if (msg.includes("user rejected") || msg.includes("user denied") || msg.includes("rejected the request")) {
    return "you cancelled the request.";
  }
  if (
    msg.includes("insufficient funds") ||
    msg.includes("insufficient balance") ||
    msg.includes("exceeds balance") ||
    msg.includes("insufficient gas") ||
    msg.includes("insufficient usdc") ||
    msg.includes("not enough usdc") ||
    msg.includes("balance too low") ||
    // Circle wraps gas-station failures with these phrases
    msg.includes("gas station") ||
    msg.includes("paymaster") ||
    msg.includes("rejected gas")
  ) {
    return "your wallet is out of usdc for gas. top it up from the arc faucet and try again.";
  }
  if (msg.includes("chain mismatch") || msg.includes("does not match") || (msg.includes("chain") && msg.includes("switch"))) {
    return "wrong network. switch to arc and try again.";
  }
  if (
    msg.includes("notallowederror") ||
    msg.includes("invalidstateerror") ||
    msg.includes("passkey") ||
    msg.includes("webauthn") ||
    msg.includes("credential")
  ) {
    return "passkey sign-in failed. try again.";
  }
  if (msg.includes("entity config") || msg.includes("circle is not configured")) {
    return "email sign-in is not available right now.";
  }
  if (msg.includes("email begin failed") || msg.includes("relation") || msg.includes("does not exist")) {
    return "the server isn't ready: database migrations haven't run. ask the operator to run npm run migrate.";
  }
  if (msg.includes("timeout") || msg.includes("timed out") || msg.includes("still pending")) {
    return "the request timed out. it may still land; check arcscan in a minute.";
  }
  // viem revert errors carry the on-chain revert reason inside the message
  if (msg.includes("execution reverted") || msg.includes("contractfunctionexecutionerror")) {
    const reason = extractRevertReason(e);
    return reason ? `transaction reverted: ${reason}.` : "the contract rejected this. check requirements and try again.";
  }
  if (msg.includes("nonce") || msg.includes("signature") || msg.includes("verify")) {
    return "could not verify your signature. try again.";
  }
  if (msg.includes("no injected") || msg.includes("provider") || msg.includes("no wallet")) {
    return "no wallet found. install a wallet, or use email instead.";
  }
  return fallback;
}

/// The raw error message, trimmed to a single readable line. Use this when
/// you want a small diagnostic underneath the friendly summary.
export function rawErrorDetail(e: unknown, max = 180): string {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  const flat = msg.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function extractRevertReason(e: unknown): string | null {
  if (!(e instanceof Error)) return null;
  const m = e.message.match(/reverted:?\s*"([^"]+)"/i) || e.message.match(/reason:?\s*"([^"]+)"/i);
  return m?.[1] ?? null;
}
