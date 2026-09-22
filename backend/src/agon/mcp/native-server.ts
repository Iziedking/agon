import { McpServer, createMcpHandler, fromJsonSchema, type AuthInfo } from "@modelcontextprotocol/server";

import { createMcpAccessAdapter } from "./adapter.ts";

type AccessAdapter = ReturnType<typeof createMcpAccessAdapter>;

const openObject = fromJsonSchema<Record<string, unknown>>({
  type: "object",
  additionalProperties: true,
});

const searchSchema = fromJsonSchema<Record<string, unknown>>({
  type: "object",
  properties: {
    query: { type: "string", description: "The outcome, skill, or service name to find." },
    category: { type: "string" },
    verifiedOnly: { type: "boolean" },
    maxPriceUSDC: { type: "string" },
    maxLatencyMs: { type: "number" },
    limit: { type: "number" },
  },
  additionalProperties: false,
});

const referenceSchema = fromJsonSchema<{ reference: string }>({
  type: "object",
  properties: { reference: { type: "string", minLength: 1 } },
  required: ["reference"],
  additionalProperties: false,
});

const hirePreviewSchema = fromJsonSchema<{ serviceReference: string; input: Record<string, unknown>; paymentMode?: "pay_per_call" | "escrow" }>({
  type: "object",
  properties: {
    serviceReference: { type: "string", minLength: 1 },
    input: { type: "object", additionalProperties: true },
    paymentMode: { type: "string", enum: ["pay_per_call", "escrow"] },
  },
  required: ["serviceReference", "input"],
  additionalProperties: false,
});

const hireAuthorizationSchema = fromJsonSchema<{ hireId: string; termsDigest: string; approval: "approve"; idempotencyKey: string }>({
  type: "object",
  properties: {
    hireId: { type: "string", minLength: 1 },
    termsDigest: { type: "string", minLength: 1 },
    approval: { type: "string", const: "approve" },
    idempotencyKey: { type: "string", minLength: 1 },
  },
  required: ["hireId", "termsDigest", "approval", "idempotencyKey"],
  additionalProperties: false,
});

const hireStatusSchema = fromJsonSchema<{ hireId: string }>({
  type: "object",
  properties: { hireId: { type: "string", minLength: 1 } },
  required: ["hireId"],
  additionalProperties: false,
});

function result(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function failure(code: string, message: string) {
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: { code, message } }, null, 2) }], isError: true };
}

function adapterResult(value: { ok: true; value: unknown } | { ok: false; code: string; message: string }) {
  return value.ok ? result(value.value) : failure(value.code, value.message);
}

function actor(authInfo: AuthInfo | undefined): string | null {
  const address = authInfo?.extra?.address;
  return typeof address === "string" && address ? address : null;
}

function requireActor(authInfo: AuthInfo | undefined): string | ReturnType<typeof failure> {
  const address = actor(authInfo);
  return address ?? failure("authentication_required", "Connect AGON with an access token before preparing a hire or managing a listing.");
}

/**
 * Standards-based MCP tool surface. Public discovery remains available without
 * an account. Every provider or buyer mutation receives the authenticated AGON
 * wallet address from the validated bearer token at the HTTP edge.
 */
export function createAgonNativeMcpHandler(access: AccessAdapter) {
  return createMcpHandler((context) => {
    const server = new McpServer({ name: "AGON", version: "1.0.0" });

    server.registerTool("search_services", {
      title: "Search AGON services",
      description: "Find pay-per-use agent services by result, skill, category, price, latency, or verification state.",
      inputSchema: searchSchema,
    }, async (input) => adapterResult(await access.searchServices(input)));

    server.registerTool("get_service", {
      title: "Get service terms",
      description: "Read the buyer-facing terms for one exact AGON service reference.",
      inputSchema: referenceSchema,
    }, async ({ reference }) => adapterResult(await access.getService(reference)));

    server.registerTool("preview_hire", {
      title: "Preview a hire",
      description: "Bind an exact service, input, price, and delivery terms before approval. This does not charge a wallet.",
      inputSchema: hirePreviewSchema,
    }, async (input) => {
      const authenticatedActor = requireActor(context.authInfo);
      return typeof authenticatedActor === "string"
        ? adapterResult(await access.previewHire(authenticatedActor, input))
        : authenticatedActor;
    });

    server.registerTool("authorize_hire", {
      title: "Approve a reviewed hire",
      description: "Advance a previously previewed hire only after the user confirms its exact terms digest. Wallet execution remains subject to the configured AGON policy.",
      inputSchema: hireAuthorizationSchema,
    }, async ({ hireId, ...input }) => {
      const authenticatedActor = requireActor(context.authInfo);
      return typeof authenticatedActor === "string"
        ? adapterResult(await access.authorizeHire(authenticatedActor, hireId, input))
        : authenticatedActor;
    });

    server.registerTool("get_hire_status", {
      title: "Get hire status",
      description: "Read payment, delivery, and reconciliation status for a previously previewed AGON hire.",
      inputSchema: hireStatusSchema,
    }, async ({ hireId }) => {
      const authenticatedActor = requireActor(context.authInfo);
      return typeof authenticatedActor === "string"
        ? adapterResult(await access.getWork(authenticatedActor, hireId))
        : authenticatedActor;
    });

    server.registerTool("start_listing", {
      title: "Start a service listing",
      description: "Create a provider listing draft from buyer-facing service terms. This never publishes or signs anything.",
      inputSchema: openObject,
    }, async (input) => {
      const authenticatedActor = requireActor(context.authInfo);
      return typeof authenticatedActor === "string"
        ? adapterResult(await access.startListing(authenticatedActor, input))
        : authenticatedActor;
    });

    server.registerTool("check_listing", {
      title: "Check a service listing",
      description: "Run provider draft checks and identify the next safe action before a publication request is prepared.",
      inputSchema: openObject,
    }, async (input) => {
      const authenticatedActor = requireActor(context.authInfo);
      return typeof authenticatedActor === "string"
        ? adapterResult(await access.checkListing(authenticatedActor, input))
        : authenticatedActor;
    });

    server.registerTool("compile_listing", {
      title: "Compile a checked listing",
      description: "Create the immutable service record from a checked draft. This does not publish or sign anything.",
      inputSchema: openObject,
    }, async (input) => {
      const authenticatedActor = requireActor(context.authInfo);
      return typeof authenticatedActor === "string"
        ? adapterResult(await access.compileListing(authenticatedActor, input))
        : authenticatedActor;
    });

    server.registerTool("prepare_listing_publication", {
      title: "Prepare listing publication",
      description: "Prepare the exact provider wallet action needed to publish a compiled listing. The provider must review and sign it separately.",
      inputSchema: openObject,
    }, async (input) => {
      const authenticatedActor = requireActor(context.authInfo);
      return typeof authenticatedActor === "string"
        ? adapterResult(await access.publishListing(authenticatedActor, input))
        : authenticatedActor;
    });

    server.registerTool("prepare_listing_version", {
      title: "Prepare a listing version",
      description: "Prepare publication for a checked draft that updates an existing service. The provider must review and sign it separately.",
      inputSchema: openObject,
    }, async (input) => {
      const authenticatedActor = requireActor(context.authInfo);
      return typeof authenticatedActor === "string"
        ? adapterResult(await access.publishListingVersion(authenticatedActor, input))
        : authenticatedActor;
    });

    server.registerTool("pause_listing", {
      title: "Prepare a listing pause",
      description: "Prepare the provider wallet action to pause an existing service listing.",
      inputSchema: openObject,
    }, async (input) => {
      const authenticatedActor = requireActor(context.authInfo);
      return typeof authenticatedActor === "string"
        ? adapterResult(await access.pauseListing(authenticatedActor, input))
        : authenticatedActor;
    });

    server.registerTool("confirm_listing", {
      title: "Confirm a signed listing action",
      description: "Verify the transaction receipt for a provider-approved listing, version, or pause action. Supply a transaction hash only after the wallet has signed and broadcast it.",
      inputSchema: openObject,
    }, async (input) => {
      const authenticatedActor = requireActor(context.authInfo);
      return typeof authenticatedActor === "string"
        ? adapterResult(await access.confirmListing(authenticatedActor, input))
        : authenticatedActor;
    });

    server.registerTool("get_listing_publication", {
      title: "Get listing publication status",
      description: "Read the current preparation or confirmation state for a provider listing draft.",
      inputSchema: fromJsonSchema<{ draftId: string }>({
        type: "object",
        properties: { draftId: { type: "string", minLength: 1 } },
        required: ["draftId"],
        additionalProperties: false,
      }),
    }, async ({ draftId }) => {
      const authenticatedActor = requireActor(context.authInfo);
      return typeof authenticatedActor === "string"
        ? adapterResult(await access.getListingPublication(authenticatedActor, draftId))
        : authenticatedActor;
    });

    return server;
  }, { responseMode: "json" });
}
