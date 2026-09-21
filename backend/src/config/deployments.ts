import { z } from "zod";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const address = z.string().regex(/^0x[a-fA-F0-9]{40}$/, "expected deployed contract address");
// The receipt stores compiler metadata beside one record per contract. Keep
// the parser forward-compatible while protocol readiness validates the
// contract records it actually consumes.
const sourceVerification = z.record(z.unknown()).optional();
const contractInterfaces = z.object({
  AgonJobEscrow: z.enum(["legacy-fee-input", "v1-fixed-fee"]).optional(),
  AgonJobEscrowV2: z.literal("v2-governed-fee").optional(),
}).optional();
const schema = z.object({
  chainId: z.number().int().positive(),
  deployBlock: z.number().int().nonnegative().optional(),
  contracts: z.object({
    AgonProfileRegistry: z.string(),
    AgonServiceRegistry: z.string(),
    AgonServiceRegistryV2: address.optional(),
    AgonJobEscrow: address.optional(),
    AgonJobEscrowV2: address.optional(),
    AgonArena: address.optional(),
    AgonSyndicateRegistry: address.optional(),
    AgonPrizeVault: address.optional(),
  }),
  contractInterfaces,
  external: z.object({
    IdentityRegistry: z.object({ address, chainId: z.number().int().positive() }),
    ValidationRegistry: z.object({ address, chainId: z.number().int().positive() }).optional(),
  }),
  sourceVerification,
});

export type AgonDeployment = z.infer<typeof schema> & {
  contracts: {
    AgonProfileRegistry: `0x${string}`;
    AgonServiceRegistry: `0x${string}`;
    AgonServiceRegistryV2?: `0x${string}`;
    AgonJobEscrow?: `0x${string}`;
    AgonJobEscrowV2?: `0x${string}`;
    AgonArena?: `0x${string}`;
    AgonSyndicateRegistry?: `0x${string}`;
    AgonPrizeVault?: `0x${string}`;
  };
  contractInterfaces?: {
    AgonJobEscrow?: "legacy-fee-input" | "v1-fixed-fee";
    AgonJobEscrowV2?: "v2-governed-fee";
  };
  external: {
    IdentityRegistry: { address: `0x${string}`; chainId: number };
    ValidationRegistry?: { address: `0x${string}`; chainId: number };
  };
  sourceVerification?: Record<string, unknown>;
};

export function parseAgonDeployment(input: unknown, options: { registrationMode: boolean }) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return parsed;
  if (options.registrationMode) {
    const issues: z.ZodIssue[] = [];
    for (const name of ["AgonProfileRegistry", "AgonServiceRegistry"] as const) {
      if (!address.safeParse(parsed.data.contracts[name]).success) {
        issues.push({
          code: "custom",
          message: "real deployment receipt address required",
          path: ["contracts", name],
        });
      }
    }
    if (issues.length) return { success: false as const, issues };
  }
  return { success: true as const, data: parsed.data as AgonDeployment };
}

export type AgonDeploymentLoad = {
  deployment: AgonDeployment | null;
  error: string | null;
  path: string;
};

export function loadAgonDeployment(file: string): AgonDeploymentLoad {
  const path = resolve(process.cwd(), file);
  try {
    const parsedJson = JSON.parse(readFileSync(path, "utf8")) as unknown;
    const parsed = parseAgonDeployment(parsedJson, { registrationMode: true });
    if (!parsed.success) {
      const issues = "error" in parsed ? parsed.error.issues : parsed.issues;
      return {
        deployment: null,
        error: issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
        path,
      };
    }
    return { deployment: parsed.data, error: null, path };
  } catch (error) {
    return {
      deployment: null,
      error: error instanceof Error ? error.message : "could not read Agon deployment",
      path,
    };
  }
}

/** The marketplace uses V2 when its separate deployment is recorded. */
export function activeAgonServiceRegistry(deployment: AgonDeployment): `0x${string}` {
  return deployment.contracts.AgonServiceRegistryV2 ?? deployment.contracts.AgonServiceRegistry;
}

/**
 * Adapters that operate on marketplace listings receive the active registry
 * under the long-standing field name. The canonical receipt still preserves
 * the immutable V1 address beside the optional V2 address.
 */
export function withActiveAgonServiceRegistry(deployment: AgonDeployment): AgonDeployment {
  const active = activeAgonServiceRegistry(deployment);
  if (active === deployment.contracts.AgonServiceRegistry) return deployment;
  return {
    ...deployment,
    contracts: { ...deployment.contracts, AgonServiceRegistry: active },
  };
}
