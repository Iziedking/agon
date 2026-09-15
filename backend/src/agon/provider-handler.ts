import { createHash } from "node:crypto";

const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

export type ProviderHandlerContext = {
  requestId: string;
  idempotencyKey: string;
  payer: `0x${string}`;
  network: "eip155:5042002";
  paymentTransaction: string;
  signal: AbortSignal;
};

export type CategoryHandler<Input = unknown, Output = unknown> = (
  input: Input,
  context: ProviderHandlerContext,
) => Promise<Output>;

export type ProviderHandlerLimits = {
  timeoutMs: number;
  maxRequestBytes: number;
  maxResponseBytes: number;
};

export type ProviderDeliveryEvidence = {
  requestId: string;
  idempotencyKey: string;
  responseHash: `0x${string}`;
  responseBytes: number;
  serviceStatus: 200;
  deliveredAt: Date;
};

export type ProviderHandlerErrorCode =
  | "invalid_json"
  | "request_too_large"
  | "idempotency_required"
  | "idempotency_conflict"
  | "handler_timeout"
  | "handler_failed"
  | "response_too_large";

export class ProviderHandlerError extends Error {
  readonly code: ProviderHandlerErrorCode;
  constructor(code: ProviderHandlerErrorCode, message: string = code) {
    super(message);
    this.name = "ProviderHandlerError";
    this.code = code;
  }
}

function bounded(value: number, fallback: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.max(min, Math.min(Math.floor(value), max)) : fallback;
}

function sha256(value: string): `0x${string}` {
  return `0x${createHash("sha256").update(value).digest("hex")}` as `0x${string}`;
}

function jsonBytes(value: unknown): { encoded: string; bytes: number } {
  let encoded: string;
  try { encoded = JSON.stringify(value); } catch { throw new ProviderHandlerError("handler_failed", "handler returned a non-JSON value"); }
  if (encoded === undefined) throw new ProviderHandlerError("handler_failed", "handler returned an undefined value");
  return { encoded, bytes: Buffer.byteLength(encoded, "utf8") };
}

export function createProviderHandler<Input = unknown, Output = unknown>(options: {
  handler: CategoryHandler<Input, Output>;
  limits?: Partial<ProviderHandlerLimits>;
}) {
  const limits: ProviderHandlerLimits = {
    timeoutMs: bounded(options.limits?.timeoutMs ?? 15_000, 15_000, 250, 30_000),
    maxRequestBytes: bounded(options.limits?.maxRequestBytes ?? 65_536, 65_536, 1, 1_048_576),
    maxResponseBytes: bounded(options.limits?.maxResponseBytes ?? 524_288, 524_288, 1, 4 * 1024 * 1024),
  };
  const completed = new Map<string, { inputHash: string; result: Output; evidence: ProviderDeliveryEvidence }>();

  async function execute(input: {
    requestId: string;
    body: string;
    idempotencyKey: string;
    payment: { payer: `0x${string}`; network: "eip155:5042002"; transaction: string };
  }): Promise<{ result: Output; evidence: ProviderDeliveryEvidence; replay: boolean }> {
    if (Buffer.byteLength(input.body, "utf8") > limits.maxRequestBytes) throw new ProviderHandlerError("request_too_large", "request body exceeds the provider limit");
    if (!IDEMPOTENCY_KEY.test(input.idempotencyKey)) throw new ProviderHandlerError("idempotency_required", "a valid idempotency key is required");
    const inputHash = sha256(input.body);
    const cacheKey = `${input.payment.payer.toLowerCase()}:${input.idempotencyKey}`;
    const previous = completed.get(cacheKey);
    if (previous) {
      if (previous.inputHash !== inputHash) throw new ProviderHandlerError("idempotency_conflict", "idempotency key was reused for different input");
      return { result: previous.result, evidence: previous.evidence, replay: true };
    }
    let parsed: Input;
    try { parsed = (input.body ? JSON.parse(input.body) : null) as Input; } catch { throw new ProviderHandlerError("invalid_json", "request body is not valid JSON"); }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), limits.timeoutMs);
    let result: Output;
    try {
      result = await Promise.race([
        options.handler(parsed, { requestId: input.requestId, idempotencyKey: input.idempotencyKey, payer: input.payment.payer, network: input.payment.network, paymentTransaction: input.payment.transaction, signal: controller.signal }),
        new Promise<Output>((_, reject) => controller.signal.addEventListener("abort", () => reject(new ProviderHandlerError("handler_timeout", "category handler timed out")), { once: true })),
      ]);
    } catch (error) {
      if (error instanceof ProviderHandlerError) throw error;
      throw new ProviderHandlerError("handler_failed", "category handler failed");
    } finally { clearTimeout(timer); }
    const encoded = jsonBytes(result);
    if (encoded.bytes > limits.maxResponseBytes) throw new ProviderHandlerError("response_too_large", "handler response exceeds the provider limit");
    const evidence: ProviderDeliveryEvidence = { requestId: input.requestId, idempotencyKey: input.idempotencyKey, responseHash: sha256(encoded.encoded), responseBytes: encoded.bytes, serviceStatus: 200, deliveredAt: new Date() };
    completed.set(cacheKey, { inputHash, result, evidence });
    return { result, evidence, replay: false };
  }

  return { limits, execute };
}
