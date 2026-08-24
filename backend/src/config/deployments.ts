import { z } from "zod";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const address = z.string().regex(/^0x[a-fA-F0-9]{40}$/, "expected deployed contract address");
const schema = z.object({
  chainId: z.number().int().positive(),
  contracts: z.object({
    AgonProfileRegistry: z.string(),
    AgonServiceRegistry: z.string(),
    AgonJobEscrow: address.optional(),
    AgonArena: address.optional(),
    AgonSyndicateRegistry: address.optional(),
    AgonPrizeVault: address.optional(),
  }),
  external: z.object({
    IdentityRegistry: z.object({ address, chainId: z.number().int().positive() }),
  }),
});

export type AgonDeployment = z.infer<typeof schema> & {
  contracts: {
    AgonProfileRegistry: `0x${string}`;
    AgonServiceRegistry: `0x${string}`;
    AgonJobEscrow?: `0x${string}`;
    AgonArena?: `0x${string}`;
    AgonSyndicateRegistry?: `0x${string}`;
    AgonPrizeVault?: `0x${string}`;
  };
  external: { IdentityRegistry: { address: `0x${string}`; chainId: number } };
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
