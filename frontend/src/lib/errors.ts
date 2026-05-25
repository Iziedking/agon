/// Maps raw wallet, viem, and Circle errors to short, friendly messages.
/// Never show a raw error string in the UI.
export function friendlyError(e: unknown, fallback = "something went wrong. try again."): string {
  const msg = (e instanceof Error ? e.message : String(e ?? "")).toLowerCase();

  if (msg.includes("user rejected") || msg.includes("user denied") || msg.includes("rejected the request")) {
    return "you cancelled the request.";
  }
  if (msg.includes("insufficient funds") || msg.includes("insufficient balance") || msg.includes("exceeds balance")) {
    return "not enough balance for gas. get testnet usdc from the faucet.";
  }
  if (msg.includes("chain mismatch") || msg.includes("does not match") || (msg.includes("chain") && msg.includes("switch"))) {
    return "wrong network. switch to arc and try again.";
  }
  if (msg.includes("passkey") || msg.includes("webauthn") || msg.includes("credential") || msg.includes("not allowed")) {
    return "passkey sign-in failed. try again.";
  }
  if (msg.includes("entity config") || msg.includes("circle")) {
    return "email sign-in is not available right now.";
  }
  if (msg.includes("timeout") || msg.includes("timed out")) {
    return "the request timed out. try again.";
  }
  if (msg.includes("nonce") || msg.includes("signature") || msg.includes("verify")) {
    return "could not verify your signature. try again.";
  }
  if (msg.includes("no injected") || msg.includes("provider") || msg.includes("no wallet")) {
    return "no wallet found. install a wallet, or use email instead.";
  }
  return fallback;
}
