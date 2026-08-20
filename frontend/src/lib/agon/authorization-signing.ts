import type { X402AuthorizationView } from "./types";

export type X402SigningGate = "preview_disabled" | "connect_wallet" | "switch_chain" | "wrong_account" | "ready";

export function getX402SigningGate(
  authorization: X402AuthorizationView,
  input: { preview: boolean; address?: string; isConnected: boolean; chainId?: number },
): X402SigningGate {
  if (input.preview) return "preview_disabled";
  if (!input.isConnected || !input.address) return "connect_wallet";
  if (input.chainId !== 5042002) return "switch_chain";
  if (input.address.toLowerCase() !== authorization.payload.message.from.toLowerCase()) return "wrong_account";
  return "ready";
}
