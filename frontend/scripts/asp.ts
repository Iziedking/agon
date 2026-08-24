import { existsSync, readFileSync, writeFileSync } from "node:fs";

import {
  AspCommandError,
  confirmAspOperation,
  fetchAspListing,
  getAspHealth,
  prepareAspListing,
  publishAspListing,
  verifyAspManifest,
} from "../src/lib/agon/asp.ts";

type Options = Record<string, string | boolean>;

function parseArgs(argv: string[]): { command: string; options: Options } {
  const [command = "help", ...rest] = argv;
  const options: Options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (!arg?.startsWith("--")) throw new AspCommandError("invalid_arguments", `Unexpected argument: ${arg ?? ""}`);
    const key = arg.slice(2);
    if (key === "yes" || key === "json" || key === "force") options[key] = true;
    else {
      const value = rest[index + 1];
      if (!value || value.startsWith("--")) throw new AspCommandError("invalid_arguments", `Missing value for --${key}`);
      options[key] = value;
      index += 1;
    }
  }
  return { command, options };
}

function stringOption(options: Options, key: string, fallback = ""): string {
  const value = options[key];
  return typeof value === "string" ? value : fallback;
}

function requiredOption(options: Options, key: string): string {
  const value = stringOption(options, key);
  if (!value) throw new AspCommandError("invalid_arguments", `--${key} is required`);
  return value;
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new AspCommandError("invalid_file", `Could not read JSON file: ${path}`);
  }
}

function writeJson(path: string, value: unknown, force: boolean): void {
  if (existsSync(path) && !force) throw new AspCommandError("file_exists", `Refusing to replace ${path}; add --force after reviewing it`);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function output(value: unknown, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  if (typeof value === "string") console.log(value);
  else console.log(JSON.stringify(value, null, 2));
}

function help(): void {
  console.log(`Agon ASP CLI\n\nCommands:\n  categories [--json]\n  prepare --config FILE --manifest-out FILE --payload-out FILE [--force]\n  verify-manifest --manifest FILE [--expected-hash HASH] [--json]\n  health --api-url URL [--json]\n  inspect --api-url URL --reference REF [--manifest FILE] [--current-owner ADDRESS] [--json]\n  publish --api-url URL --config FILE --manifest FILE --token-env NAME --yes [--json]\n  confirm --api-url URL --operation ID --tx-hash HASH --token-env NAME [--json]`);
}

async function main(): Promise<void> {
  const { command, options } = parseArgs(process.argv.slice(2));
  const json = options.json === true;
  if (command === "help") {
    help();
    return;
  }
  if (command === "categories") {
    const { AGON_CATEGORIES } = await import("../src/lib/agon/catalog.ts");
    output(AGON_CATEGORIES, json);
    return;
  }
  if (command === "prepare") {
    const prepared = prepareAspListing(readJson(requiredOption(options, "config")));
    writeJson(requiredOption(options, "manifest-out"), prepared.manifest, options.force === true);
    writeJson(requiredOption(options, "payload-out"), prepared.request, options.force === true);
    output({ ...prepared, canonicalManifest: undefined }, json);
    return;
  }
  if (command === "verify-manifest") {
    const result = verifyAspManifest(readJson(requiredOption(options, "manifest")), stringOption(options, "expected-hash") || undefined);
    output(result, json);
    if (!result.valid || (result.expectedHash && result.state !== "match")) process.exitCode = 1;
    return;
  }
  if (command === "health") {
    output(await getAspHealth(requiredOption(options, "api-url")), json);
    return;
  }
  if (command === "inspect") {
    const listing = await fetchAspListing(requiredOption(options, "api-url"), requiredOption(options, "reference"));
    const manifestPath = stringOption(options, "manifest");
    const manifest = manifestPath ? readJson(manifestPath) : undefined;
    const { inspectAspListing } = await import("../src/lib/agon/asp.ts");
    output(inspectAspListing(listing, manifest, stringOption(options, "current-owner") || null), json);
    return;
  }
  if (command === "publish") {
    const prepared = prepareAspListing(readJson(requiredOption(options, "config")));
    const tokenEnv = requiredOption(options, "token-env");
    output(await publishAspListing({
      apiUrl: requiredOption(options, "api-url"),
      token: process.env[tokenEnv] ?? "",
      confirmed: options.yes === true,
      prepared,
      localManifest: readJson(requiredOption(options, "manifest")),
    }), json);
    return;
  }
  if (command === "confirm") {
    const tokenEnv = requiredOption(options, "token-env");
    output(await confirmAspOperation({
      apiUrl: requiredOption(options, "api-url"),
      token: process.env[tokenEnv] ?? "",
      operationId: requiredOption(options, "operation"),
      txHash: requiredOption(options, "tx-hash"),
    }), json);
    return;
  }
  throw new AspCommandError("invalid_command", `Unknown command: ${command}`);
}

main().catch((error: unknown) => {
  const failure = error instanceof AspCommandError ? error : new AspCommandError("failed", error instanceof Error ? error.message : String(error));
  console.error(`${failure.code}: ${failure.message}`);
  if (failure.issues.length) console.error(JSON.stringify(failure.issues, null, 2));
  process.exitCode = 1;
});
