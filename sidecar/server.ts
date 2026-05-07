/**
 * AskStinger sidecar — HTTP shim around `openswarm exec`.
 *
 * Per ADR 0007 in AskStinger/Agent: this fork is GPL-3.0 and runs as
 * an arms-length process. AskStinger calls /dispatch over HTTP and
 * never imports OpenSwarm code at the source level. Node 22+ is the
 * only runtime requirement — no new npm deps beyond Node builtins.
 *
 * Surface:
 *   GET  /health    → {status, upstream, pid}
 *   POST /dispatch  → wraps `openswarm exec`, returns
 *                     {ok, exitCode, stdout, stderr, durationMs}
 *
 * Exit-code semantics mirror upstream `openswarm exec`:
 *   0 = success, 1 = failure, 2 = timeout
 */
import { spawn } from "node:child_process";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { hostname } from "node:os";
import { performance } from "node:perf_hooks";

const PORT = Number(process.env.PORT ?? 7474);
const HOST = process.env.HOST ?? "127.0.0.1";
// Hard cap concurrent dispatches so a runaway client cannot exhaust
// host CPU. AskStinger's connector registry is the upstream rate
// limiter; this is just a safety net.
const MAX_INFLIGHT = Number(process.env.MAX_INFLIGHT ?? 4);
// Pin recorded for /health so AskStinger can verify what it's talking
// to. Bumped manually whenever the upstream SHA pin changes.
const UPSTREAM_PIN = "v0.4.4-4737b5d";

let inflight = 0;

interface DispatchBody {
  prompt: string;
  repoPath?: string;
  model?: string;
  role?: "worker" | "reviewer" | "tester" | "documenter";
  timeoutSeconds?: number;
}

interface DispatchResult {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  upstream: string;
}

async function readJson<T>(req: IncomingMessage, maxBytes = 64_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(JSON.parse(text || "{}") as T);
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function dispatchOpenswarmExec(body: DispatchBody): Promise<DispatchResult> {
  return new Promise((resolve) => {
    const start = performance.now();
    const args = ["exec", body.prompt];
    if (body.repoPath) args.push("--path", body.repoPath);
    if (body.model) args.push("--model", body.model);
    if (body.role) args.push("--role", body.role);
    const timeout = body.timeoutSeconds ?? 600;
    args.push("--timeout", String(timeout));

    let stdout = "";
    let stderr = "";
    const child = spawn("openswarm", args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    child.stdout?.on("data", (b: Buffer) => {
      stdout += b.toString("utf8");
    });
    child.stderr?.on("data", (b: Buffer) => {
      stderr += b.toString("utf8");
    });
    // Hard kill if the process outruns its declared timeout +5s grace.
    const killTimer = setTimeout(() => child.kill("SIGKILL"), (timeout + 5) * 1000);
    child.on("close", (code, signal) => {
      clearTimeout(killTimer);
      const exitCode = code ?? (signal === "SIGKILL" ? 2 : 1);
      resolve({
        ok: exitCode === 0,
        exitCode,
        stdout,
        stderr,
        durationMs: Math.round(performance.now() - start),
        upstream: UPSTREAM_PIN,
      });
    });
    child.on("error", (err) => {
      clearTimeout(killTimer);
      resolve({
        ok: false,
        exitCode: 1,
        stdout,
        stderr: stderr + (stderr ? "\n" : "") + String(err),
        durationMs: Math.round(performance.now() - start),
        upstream: UPSTREAM_PIN,
      });
    });
  });
}

const server = createServer(async (req, res) => {
  const url = req.url ?? "/";
  if (req.method === "GET" && url === "/health") {
    send(res, 200, { status: "alive", upstream: UPSTREAM_PIN, host: hostname(), pid: process.pid });
    return;
  }
  if (req.method === "POST" && url === "/dispatch") {
    if (inflight >= MAX_INFLIGHT) {
      send(res, 429, { ok: false, error: "too many in-flight dispatches", inflight });
      return;
    }
    let body: DispatchBody;
    try {
      body = await readJson<DispatchBody>(req);
    } catch (err) {
      send(res, 400, { ok: false, error: String(err) });
      return;
    }
    if (typeof body.prompt !== "string" || body.prompt.trim() === "") {
      send(res, 400, { ok: false, error: "missing or empty prompt" });
      return;
    }
    inflight += 1;
    try {
      const result = await dispatchOpenswarmExec(body);
      send(res, 200, result);
    } finally {
      inflight -= 1;
    }
    return;
  }
  send(res, 404, { ok: false, error: "not found" });
});

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`openswarm-sidecar listening on http://${HOST}:${PORT} (upstream ${UPSTREAM_PIN})`);
});
