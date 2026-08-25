import { decodePaymentResponseHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import { getAddress, keccak256 } from "viem";

import { evaluateX402ExecutionPolicy, type X402ExecutionPolicy } from "./x402-policy.ts";
import {
  validateX402SettlementRequest,
  type X402SettlementRequest,
  type X402SettlementResult,
} from "./x402-settlement.ts";

const MAX_RESPONSE_BYTES = 512 * 1024;

function fail(message: string): X402SettlementResult {
  return { ok: false, error: { code: "facilitator_rejected", message } };
}

function sameAddress(left: string, right: string): boolean {
  try { return getAddress(left) === getAddress(right); } catch { return false; }
}

function receiptReference(value: string): { transaction: `0x${string}` | null; providerTransferId: string | null } | null {
  if (/^0x[0-9a-fA-F]{64}$/.test(value)) return { transaction: value as `0x${string}`, providerTransferId: null };
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) return { transaction: null, providerTransferId: value.toLowerCase() };
  return null;
}

export function createX402ProviderExecutionAdapter(options: {
  enabled?: boolean;
  policy: X402ExecutionPolicy;
  fetchImpl?: typeof fetch;
}) {
  return {
    async settle(input: X402SettlementRequest): Promise<X402SettlementResult> {
      const checked = validateX402SettlementRequest(input);
      if (!checked.ok) return { ok: false, error: checked.error };
      if (options.enabled !== true) return { ok: false, error: { code: "execution_disabled", message: "x402 provider execution is disabled by policy" } };
      const policy = evaluateX402ExecutionPolicy(options.policy, input.plan);
      if (!policy.ok) return { ok: false, error: { code: policy.code, message: policy.message } };
      if (!input.delivery) return { ok: false, error: { code: "execution_not_ready", message: "provider delivery request is missing" } };
      if (input.delivery.targetUrl !== input.plan.resource.url || !/^https:\/\//i.test(input.delivery.targetUrl)) {
        return { ok: false, error: { code: "execution_not_ready", message: "provider URL does not match the reviewed x402 resource" } };
      }

      const paymentPayload = {
        x402Version: 2,
        resource: input.plan.resource,
        accepted: input.plan.requirements,
        payload: { authorization: input.plan.authorization, signature: checked.signature },
      };
      const started = Date.now();
      let response: Response;
      try {
        response = await (options.fetchImpl ?? globalThis.fetch)(input.delivery.targetUrl, {
          method: input.delivery.method,
          redirect: "error",
          headers: {
            "payment-signature": encodePaymentSignatureHeader(paymentPayload),
            ...(input.delivery.method === "POST" ? { "content-type": "application/json" } : {}),
          },
          body: input.delivery.method === "POST" ? JSON.stringify(input.delivery.input) : undefined,
          signal: AbortSignal.timeout(30_000),
        });
      } catch {
        return { ok: false, error: { code: "facilitator_unavailable", message: "provider execution failed with an unknown settlement outcome" } };
      }
      if (response.status < 200 || response.status > 299) return fail(`provider returned HTTP ${response.status} after payment authorization`);
      const paymentResponse = response.headers.get("payment-response");
      if (!paymentResponse) return fail("provider omitted the x402 PAYMENT-RESPONSE settlement proof");
      let settlement: ReturnType<typeof decodePaymentResponseHeader>;
      try { settlement = decodePaymentResponseHeader(paymentResponse); } catch { return fail("provider returned an invalid PAYMENT-RESPONSE header"); }
      const reference = receiptReference(settlement.transaction);
      if (!settlement.success || settlement.network !== input.plan.requirements.network || !reference) return fail("provider returned invalid Arc Testnet settlement evidence");
      if (settlement.payer && !sameAddress(settlement.payer, input.plan.authorization.from)) return fail("provider settlement payer does not match the approved buyer");
      if (settlement.amount !== undefined && BigInt(settlement.amount) !== BigInt(input.plan.requirements.amount)) return fail("provider settlement amount does not match the exact quote");

      const contentLength = Number(response.headers.get("content-length") ?? "0");
      if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) return fail("provider result exceeds the 512 KiB delivery limit");
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > MAX_RESPONSE_BYTES) return fail("provider result exceeds the 512 KiB delivery limit");
      let result: unknown;
      try { result = bytes.byteLength ? JSON.parse(new TextDecoder().decode(bytes)) : null; } catch { result = { text: new TextDecoder().decode(bytes) }; }
      return {
        ok: true,
        value: {
          intentId: input.approval.intentId,
          approvalHash: input.approval.approvalHash as `0x${string}`,
          ...reference,
          network: input.plan.requirements.network,
          payer: settlement.payer && sameAddress(settlement.payer, input.plan.authorization.from) ? getAddress(settlement.payer) as `0x${string}` : null,
          executionEnabled: true,
          delivery: {
            serviceStatus: response.status,
            latencyMs: Date.now() - started,
            responseHash: keccak256(bytes),
            deliveredAt: new Date().toISOString(),
            result,
          },
        },
      };
    },
  };
}
