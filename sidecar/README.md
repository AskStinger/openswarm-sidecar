# AskStinger sidecar shim

This directory holds AskStinger's HTTP wrapper around upstream OpenSwarm.

## License boundary

This repository is a fork of `unohee/OpenSwarm` (GPL-3.0). Per ADR 0007 in
`AskStinger/Agent`, AskStinger calls this fork **only over HTTP** and never
imports its source. The boundary is the documented HTTP API in
`sidecar/server.ts`. Any change that pulls OpenSwarm code into the
AskStinger Python codebase requires superseding ADR 0007.

## Public contract

The sidecar is a Node 22+ HTTP server. No new npm dependencies — Node
builtins only.

### `GET /health`

```json
{ "status": "alive", "upstream": "v0.4.4-4737b5d", "host": "...", "pid": 12345 }
```

### `POST /dispatch`

Wraps `openswarm exec` and returns a structured result. Exit-code
semantics mirror upstream: `0` success / `1` failure / `2` timeout.

Request body:

```json
{
  "prompt": "Refactor packages/llm/scripted.py to expose a streaming method.",
  "repoPath": "/home/runner/repo",
  "model": "claude-sonnet-4-6",
  "role": "worker",
  "timeoutSeconds": 600
}
```

| Field            | Type   | Required | Notes                                  |
| ---------------- | ------ | -------- | -------------------------------------- |
| `prompt`         | string | yes      | Task description forwarded to upstream |
| `repoPath`       | string | no       | Defaults to upstream cwd               |
| `model`          | string | no       | Worker model override (`-m`)           |
| `role`           | enum   | no       | `worker`/`reviewer`/`tester`/`documenter` |
| `timeoutSeconds` | int    | no       | Default 600s; +5s grace before SIGKILL |

Response body (200):

```json
{
  "ok": true,
  "exitCode": 0,
  "stdout": "...",
  "stderr": "...",
  "durationMs": 12345,
  "upstream": "v0.4.4-4737b5d"
}
```

A 400 response means the request was malformed (missing prompt,
oversized payload). A 429 means the sidecar is at `MAX_INFLIGHT` (4 by
default); AskStinger's connector registry is the canonical rate limiter.

## Running

```bash
npm install        # one-time
npm run sidecar    # starts server on 127.0.0.1:7474
```

Environment variables:

| Var            | Default     | Notes                                    |
| -------------- | ----------- | ---------------------------------------- |
| `HOST`         | `127.0.0.1` | Bind address. Keep loopback by default.  |
| `PORT`         | `7474`      | Listen port.                             |
| `MAX_INFLIGHT` | `4`         | Concurrent `openswarm exec` cap.         |

The sidecar requires `openswarm` to be on `PATH` and `claude -p`
authenticated in the same environment. Containerised deployment (PR-OS2)
will document credential placement.

## What this is NOT

- **Not a public-facing API.** Bind loopback. AskStinger reaches it
  through Docker network in PR-OS2; never directly internet-exposed.
- **Not an authentication boundary.** Trust comes from process
  isolation and Docker network scoping. AskStinger's FERPA gate +
  Entra JWT run *before* anything reaches the sidecar.
- **Not a replacement for `packages/llm/`.** AskStinger's first-party
  Anthropic client stays the canonical LLM surface. The sidecar is
  additive — it exists for OpenSwarm's worker/reviewer pipeline,
  Codex/local-model adapters, and the BS Detector.

## Upstream pin

This branch is pinned to upstream `v0.4.4` (SHA `4737b5d2c93d`). See
`/ASKSTINGER_PIN.md` at the repo root for the bump history. Do not
auto-merge upstream `main` — pin bumps go through PR review.
