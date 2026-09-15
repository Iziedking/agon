import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getAddress } from "viem";

import {
  AGON_X402_AGENT_POLICY_NETWORK,
  type X402AgentWalletSettlementAdapter,
} from "./x402-agent-policy.ts";

const ARC_USDC = "0x3600000000000000000000000000000000000000" as const;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type AgentTransfer = (params: {
  walletId: string;
  destinationAddress: `0x${string}`;
  amountBaseUnits: bigint;
  idempotencyKey: string;
  refId?: string;
}) => Promise<{ id: string; state: string }>;

async function defaultTransfer(input: Parameters<AgentTransfer>[0]): ReturnType<AgentTransfer> {
  // Circle Agent Wallets are operated by the Agent Stack CLI. The command is
  // reached only when live execution is explicitly enabled; tests and the
  // default startup path never spawn it.
  const run = promisify(execFile);
  const command = process.platform === "win32" ? "circle.cmd" : "circle";
  const whole = input.amountBaseUnits / 1_000_000n;
  const fraction = (input.amountBaseUnits % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  const amount = fraction ? `${whole}.${fraction}` : whole.toString();
  const { stdout } = await run(command, [
    "wallet", "transfer", input.destinationAddress,
    "--amount", amount,
    "--token", ARC_USDC,
    "--address", input.walletId,
    "--chain", "ARC-TESTNET",
    "--output", "json",
  ], { timeout: 30_000, maxBuffer: 256 * 1024, windowsHide: true });
  const raw = JSON.parse(stdout) as unknown;
  const parsed = Array.isArray(raw)
    ? (raw[0] as Record<string, unknown> | undefined) ?? {}
    : raw && typeof raw === "object" && "data" in raw && (raw as { data?: unknown }).data && typeof (raw as { data?: unknown }).data === "object"
      ? (raw as { data: Record<string, unknown> }).data
      : raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const id = typeof parsed.id === "string" ? parsed.id : typeof parsed.transactionId === "string" ? parsed.transactionId : typeof (parsed.transaction as Record<string, unknown> | undefined)?.id === "string" ? (parsed.transaction as Record<string, unknown>).id as string : "";
  const state = typeof parsed.state === "string" ? parsed.state : typeof parsed.status === "string" ? parsed.status : "SUBMITTED";
  return { id, state };
}

function deterministicCircleIdempotencyKey(agentId: string, key: string): string {
  // Keep a stable UUID-shaped correlation key for adapters that support it.
  // The durable Agon reservation remains the source of truth because the
  // Circle transfer CLI does not expose an idempotency-key option.
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
 * Circle Agent Wallet adapter. The durable policy supplies the Circle wallet
 * address; this module never accepts or stores a private key. A transfer
 * request is submitted only after the executor reserves the exact amount and
 * idempotency key. The CLI is disabled by default and uses ARC-TESTNET.
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
          walletId: input.walletAddress ?? input.walletId,
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
