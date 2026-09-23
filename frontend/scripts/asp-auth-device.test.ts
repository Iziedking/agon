import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import test from "node:test";

const secret = "secret-test-access-token-never-print-this";
const deviceCode = "private-device-code-never-print-this";
const address = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

async function runCli(args: string[]): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  const cwd = fileURLToPath(new URL("../", import.meta.url));
  const child = spawn(process.execPath, ["--no-warnings", "--experimental-strip-types", "scripts/asp.ts", ...args], {
    cwd,
    env: { ...process.env, AGON_API_TOKEN: "" },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
  const timeout = setTimeout(() => child.kill(), 10_000);
  try {
    const [exitCode] = await once(child, "close") as [number | null];
    return { exitCode, stdout, stderr };
  } finally {
    clearTimeout(timeout);
  }
}

test("standalone and inline ASP device auth keep bearer and device tokens out of CLI output", async () => {
  let sawAuthorizedRequest = false;
  let deviceStarts = 0;
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const path = request.url ?? "";
    if (path === "/auth/cli/device") {
      json(response, 200, {
        deviceCode,
        userCode: "ABCD-EFGH",
        verificationUri: "https://agon.example/approve",
        scopes: deviceStarts++ === 0 ? ["agon:read"] : ["playground:run"],
        expiresAt: new Date(Date.now() + 30_000).toISOString(),
        pollInterval: 0,
      });
      return;
    }
    if (path === "/auth/cli/device/token") {
      json(response, 200, { accessToken: secret });
      return;
    }
    if (path === "/auth/me") {
      json(response, 200, { address });
      return;
    }
    if (path === "/agon/playground/evaluate") {
      sawAuthorizedRequest = request.headers.authorization === `Bearer ${secret}`;
      json(response, 200, { runId: "run-1", score: 100, evidence: { root: "0x01" } });
      return;
    }
    json(response, 404, { error: "not found" });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const location = server.address();
  assert.ok(location && typeof location !== "string");
  const apiUrl = `http://127.0.0.1:${location.port}`;
  try {
    const standalone = await runCli(["auth-device", "--api-url", apiUrl, "--json"]);
    assert.equal(standalone.exitCode, 0, standalone.stderr);
    assert.equal(JSON.parse(standalone.stdout).status, "authorized");
    assert.doesNotMatch(`${standalone.stdout}${standalone.stderr}`, new RegExp(`${secret}|${deviceCode}`));

    const inline = await runCli([
      "evaluate", "--api-url", apiUrl, "--reference", `5042002:${address}:1`,
      "--version", "1", "--category", "analysis", "--task", "evidence-under-pressure",
      "--device-auth", "--json",
    ]);
    assert.equal(inline.exitCode, 0, inline.stderr);
    assert.equal(JSON.parse(inline.stdout).runId, "run-1");
    assert.equal(sawAuthorizedRequest, true);
    assert.doesNotMatch(`${inline.stdout}${inline.stderr}`, new RegExp(`${secret}|${deviceCode}`));
  } finally {
    server.close();
    await once(server, "close");
  }
});
