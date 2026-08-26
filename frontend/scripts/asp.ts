import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";

import {
  AspCommandError,
  confirmAspOperation,
  evaluateAspListing,
  fetchAspListing,
  getAspHealth,
  prepareAspListingVersion,
  prepareAspListing,
  publishAspListing,
  publishAspListingVersion,
  requestAspVerification,
  verifyAspManifest,
} from "../src/lib/agon/asp.ts";
import { scaffoldServiceProject, writeServiceScaffold } from "../src/lib/agon/service-scaffold.ts";

type Options = Record<string, string | boolean>;

function parseArgs(argv: string[]): { command: string; options: Options } {
  const [command = "help", ...rest] = argv;
  const options: Options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (!arg?.startsWith("--")) throw new AspCommandError("invalid_arguments", `Unexpected argument: ${arg ?? ""}`);
    const key = arg.slice(2);
    if (key === "yes" || key === "json" || key === "force" || key === "run") options[key] = true;
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

function writeJsonOrText(path: string, value: unknown, force: boolean): void {
  if (existsSync(path) && !force) throw new AspCommandError("file_exists", `Refusing to replace ${path}; add --force after reviewing it`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`, "utf8");
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
  console.log(`Agon ASP CLI\n\nCommands:\n  auth-device --api-url URL [--client-name NAME] [--scopes CSV] [--json]\n  categories [--json]\n  init --directory DIR --service-key KEY --name NAME --category SLUG [--description TEXT] [--force]\n  deploy --directory DIR [--target docker] [--port PORT] [--run] [--force]\n  prepare --config FILE --manifest-out FILE --payload-out FILE [--force]\n  verify-manifest --manifest FILE [--expected-hash HASH] [--json]\n  health --api-url URL [--json]\n  demo-run --api-url URL --category SLUG --task TASK_ID [--input FILE] [--json]\n  inspect --api-url URL --reference REF [--manifest FILE] [--current-owner ADDRESS] [--json]\n  publish --api-url URL --config FILE --manifest FILE --token-env NAME --yes [--json]\n  confirm --api-url URL --operation ID --tx-hash HASH --token-env NAME [--json]\n  update --api-url URL --listing-id ID --config FILE --manifest FILE --token-env NAME --yes [--json]\n  evaluate --api-url URL --reference REF --version N --category SLUG --task TASK_ID --token-env NAME [--input FILE] [--json]\n  request-verification --api-url URL --reference REF --playground-run ID --token-env NAME --yes [--expires-at ISO] [--idempotency-key KEY] [--json]\n\nAuthentication is a browser approval flow. The CLI never accepts a private key or seed phrase.`);
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
  if (command === "auth-device") {
    const apiUrl = requiredOption(options, "api-url").replace(/\/$/, "");
    let started: {
      deviceCode: string;
      userCode: string;
      verificationUri: string;
      scopes: string[];
      expiresAt: string;
      pollInterval: number;
    };
    try {
      const allowedScopes = new Set(["agon:read", "listing:prepare", "listing:write", "listing:confirm", "playground:run", "arena:prepare"]);
      const scopes = stringOption(options, "scopes", "agon:read,listing:prepare,listing:write,listing:confirm,playground:run,arena:prepare")
        .split(",")
        .map((scope) => scope.trim())
        .filter(Boolean);
      if (!scopes.length || scopes.some((scope) => !allowedScopes.has(scope))) {
        throw new AspCommandError("invalid_arguments", "--scopes must contain only Agon CLI scopes");
      }
      const response = await fetch(`${apiUrl}/auth/cli/device`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientName: stringOption(options, "client-name", "agon-cli"), scopes }),
        signal: AbortSignal.timeout(30_000),
      });
      const body = await readJsonResponse(response);
      if (!response.ok) throw new AspCommandError("auth_failed", typeof body === "object" && body && "error" in body ? String(body.error) : "could not start CLI authorization");
      started = body as typeof started;
    } catch (error) {
      if (error instanceof AspCommandError) throw error;
      throw new AspCommandError("network_unavailable", "Agon auth service did not respond");
    }

    if (!json) {
      console.log(`Open ${started.verificationUri}`);
      console.log(`Enter code: ${started.userCode}`);
      console.log("Waiting for browser approval...");
    } else {
      // Keep stdout machine-readable for agents while still showing the human
      // approval instructions immediately on the terminal.
      console.error(JSON.stringify({
        status: "authorization_required",
        verificationUri: started.verificationUri,
        userCode: started.userCode,
        scopes: started.scopes,
        expiresAt: started.expiresAt,
      }));
    }

    const deadline = new Date(started.expiresAt).getTime();
    let accessToken: string | null = null;
    while (Date.now() < deadline) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, Math.max(1, started.pollInterval) * 1000));
      let response: Response;
      let body: unknown;
      try {
        response = await fetch(`${apiUrl}/auth/cli/device/token`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ deviceCode: started.deviceCode }),
          signal: AbortSignal.timeout(30_000),
        });
        body = await readJsonResponse(response);
      } catch {
        throw new AspCommandError("network_unavailable", "Agon auth service did not respond while polling");
      }
      if (response.status === 428) continue;
      if (response.status === 410) throw new AspCommandError("auth_expired", "CLI authorization expired; start a new device login");
      if (!response.ok || typeof body !== "object" || !body || !("accessToken" in body)) {
        throw new AspCommandError("auth_failed", typeof body === "object" && body && "error" in body ? String(body.error) : "CLI authorization failed");
      }
      accessToken = String(body.accessToken);
      break;
    }
    if (!accessToken) throw new AspCommandError("auth_expired", "CLI authorization expired; start a new device login");
    output({ ...started, accessToken, tokenType: "Bearer" }, json);
    return;
  }
  if (command === "init") {
    const directory = resolve(requiredOption(options, "directory"));
    let scaffold;
    try {
      scaffold = scaffoldServiceProject({
        serviceKey: requiredOption(options, "service-key"),
        name: requiredOption(options, "name"),
        category: requiredOption(options, "category"),
        description: stringOption(options, "description") || undefined,
      });
      const files = writeServiceScaffold(directory, scaffold, options.force === true);
      output({ command, directory, serviceKey: scaffold.serviceKey, files }, json);
    } catch (error) {
      if (error instanceof AspCommandError) throw error;
      throw new AspCommandError("scaffold_failed", error instanceof Error ? error.message : String(error));
    }
    return;
  }
  if (command === "deploy") {
    const directory = resolve(requiredOption(options, "directory"));
    const target = stringOption(options, "target", "docker");
    if (target !== "docker") throw new AspCommandError("unsupported_target", "The local Docker target is the only supported deploy target in this phase");
    const port = stringOption(options, "port", "8789");
    if (!/^([1-9][0-9]{2,4})$/.test(port) || Number(port) > 65535) throw new AspCommandError("invalid_port", "--port must be a TCP port between 100 and 65535");
    const serviceFile = join(directory, "agon.service.json");
    const runtimeFile = join(directory, "service.ts");
    const dockerfile = join(directory, "Dockerfile");
    if (!existsSync(serviceFile) || !existsSync(runtimeFile) || !existsSync(dockerfile)) {
      throw new AspCommandError("invalid_service", "Directory must contain agon.service.json, service.ts, and Dockerfile. Run init first.");
    }
    const composePath = join(directory, "docker-compose.agon.yml");
    const compose = `services:\n  agon-provider:\n    build:\n      context: .\n      dockerfile: Dockerfile\n    ports:\n      - "${port}:8789"\n    environment:\n      PORT: 8789\n      PUBLIC_ENDPOINT: http://localhost:${port}/execute\n    restart: unless-stopped\n`;
    writeJsonOrText(composePath, compose, options.force === true);
    if (options.run === true) {
      execFileSync("docker", ["compose", "-f", composePath, "up", "--build", "-d"], { cwd: directory, stdio: "inherit" });
    }
    output({ command, target, directory, composePath, serviceUrl: `http://localhost:${port}/execute`, healthUrl: `http://localhost:${port}/health`, started: options.run === true }, json);
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
  if (command === "demo-run") {
    const apiUrl = requiredOption(options, "api-url").replace(/\/$/, "");
    const inputPath = stringOption(options, "input");
    const input = inputPath ? readJson(inputPath) : undefined;
    let response: Response;
    try {
      response = await fetch(`${apiUrl}/agon/playground/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ category: requiredOption(options, "category"), taskId: requiredOption(options, "task"), input }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new AspCommandError("network_unavailable", "Agon agent runtime did not respond");
    }
    const body = await readJsonResponse(response);
    if (!response.ok) throw new AspCommandError("demo_failed", typeof body === "object" && body && "error" in body ? JSON.stringify(body) : "Agon demo task failed");
    output(body, json);
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
  if (command === "update" || command === "publish-version") {
    const manifest = readJson(requiredOption(options, "manifest"));
    const prepared = prepareAspListingVersion(
      readJson(requiredOption(options, "config")),
      manifest,
      requiredOption(options, "listing-id"),
    );
    const tokenEnv = requiredOption(options, "token-env");
    output(await publishAspListingVersion({
      apiUrl: requiredOption(options, "api-url"),
      token: process.env[tokenEnv] ?? "",
      confirmed: options.yes === true,
      prepared,
      localManifest: manifest,
    }), json);
    return;
  }
  if (command === "evaluate") {
    const inputPath = stringOption(options, "input");
    const input = inputPath ? readJson(inputPath) : undefined;
    const tokenEnv = requiredOption(options, "token-env");
    const category = stringOption(options, "category") as Parameters<typeof evaluateAspListing>[0]["category"];
    output(await evaluateAspListing({
      apiUrl: requiredOption(options, "api-url"),
      token: process.env[tokenEnv] ?? "",
      listingReference: requiredOption(options, "reference"),
      listingVersion: requiredOption(options, "version"),
      category,
      taskId: requiredOption(options, "task"),
      idempotencyKey: stringOption(options, "idempotency-key", crypto.randomUUID()),
      input,
    }), json);
    return;
  }
  if (command === "request-verification") {
    const tokenEnv = requiredOption(options, "token-env");
    const expiresAt = stringOption(options, "expires-at", new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString());
    output(await requestAspVerification({
      apiUrl: requiredOption(options, "api-url"),
      token: process.env[tokenEnv] ?? "",
      confirmed: options.yes === true,
      listingReference: requiredOption(options, "reference"),
      playgroundRunId: requiredOption(options, "playground-run"),
      idempotencyKey: stringOption(options, "idempotency-key", crypto.randomUUID()),
      expiresAt,
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

async function readJsonResponse(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { throw new AspCommandError("invalid_response", "Agon returned a non-JSON response"); }
}

main().catch((error: unknown) => {
  const failure = error instanceof AspCommandError ? error : new AspCommandError("failed", error instanceof Error ? error.message : String(error));
  console.error(`${failure.code}: ${failure.message}`);
  if (failure.issues.length) console.error(JSON.stringify(failure.issues, null, 2));
  process.exitCode = 1;
});
