import { createHash } from "node:crypto";
import { getAddress } from "viem";

import {
  AGON_X402_AGENT_POLICY_NETWORK,
  type X402AgentWalletSettlementAdapter,
} from "./x402-agent-policy.ts";

const ARC_USDC = "0x3600000000000000000000000000000000000000" as const;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type AgentTransfer = (params: {
  walletId: string;
  destinationAddress: `0x${string}`;
  amountBaseUnits: bigint;
  idempotencyKey: string;
  refId?: string;
}) => Promise<{ id: string; state: string }>;

async function defaultTransfer(input: Parameters<AgentTransfer>[0]): ReturnType<AgentTransfer> {
  // Keep the Circle SDK out of tests and disabled startup paths. The dynamic
  // import is reached only when an enabled adapter actually submits a transfer.
  const module = await import("../../chain/circleDev.ts");
  return module.createAgentUsdcTransfer(input);
}

function deterministicCircleIdempotencyKey(agentId: string, key: string): string {
  // Circle's Developer-Controlled Wallets API requires a UUID-shaped
  // idempotency key. The durable Agon key is the source of truth, so derive a
  // stable UUID-shaped value instead of generating a new key on retry.
  const digest = createHash("sha256").update(`${agentId}\0${key}`, "utf8").digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-${((Number.parseInt(digest.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0")}${digest.slice(18, 20)}-${digest.slice(20, 32)}`;
}

function validAddress(value: string): value is `0x${string}` {
  try {
    getAddress(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Circle Developer-Controlled Wallets 9.6.0 adapter. The wallet id is
 * supplied by the durable policy store; this module never accepts or stores a
 * private key. A transfer request is only submitted after the executor has
 * reserved the exact amount and idempotency key.
 */
export function createCircleX402AgentWalletAdapter(options: {
  enabled: boolean;
  transfer?: AgentTransfer;
}): X402AgentWalletSettlementAdapter {
  const transfer = options.transfer ?? defaultTransfer;
  return {
    enabled: options.enabled,
    async settle(input) {
      if (!options.enabled) {
        return { ok: false, error: { code: "wallet_disabled", message: "agent wallet execution is disabled by policy" } };
      }
      if (!input.walletId.trim() || !validAddress(input.recipient) || input.amountBaseUnits <= 0n) {
        return { ok: false, error: { code: "wallet_unavailable", message: "agent wallet transfer parameters are invalid" } };
      }
      try {
        const result = await transfer({
          walletId: input.walletId,
          destinationAddress: input.recipient,
          amountBaseUnits: input.amountBaseUnits,
          idempotencyKey: deterministicCircleIdempotencyKey(input.agentId, input.idempotencyKey),
          refId: `agon-agent:${input.agentId}:${input.idempotencyKey}`.slice(0, 255),
        });
        if (!result.id || !UUID_V4.test(result.id)) {
          return { ok: false, error: { code: "wallet_unavailable", message: "Circle returned an invalid transfer id" } };
        }
        return { ok: true, providerTransferId: result.id, transaction: null };
      } catch {
        return { ok: false, error: { code: "wallet_unavailable", message: "Circle agent wallet transfer did not complete" } };
      }
    },
  };
}

export const circleAgentWalletConstants = {
  network: AGON_X402_AGENT_POLICY_NETWORK,
  asset: ARC_USDC,
} as const;
