# AskStinger upstream pin

This fork is held at a specific upstream commit so AskStinger's
sidecar contract (per ADR 0007 in `AskStinger/Agent`) doesn't drift
when upstream `main` moves.

## Current pin

| Field        | Value                                                  |
| ------------ | ------------------------------------------------------ |
| Upstream tag | `v0.4.4`                                               |
| Upstream SHA | `4737b5d2c93dadd4cd5e8a6d4bc1e01b9c6f1e1c`             |
| Pinned on    | 2026-05-07                                             |
| Pinned by    | PR-OS1 (initial fork + HTTP shim)                      |

## How to bump

1. Open an upstream comparison: `gh api repos/unohee/OpenSwarm/compare/$CURRENT_SHA...main`.
2. Read every change. Single-maintainer + pre-v1.0 means upstream
   sometimes ships breaking adapter or config changes between minor
   versions.
3. Open a PR on this fork that:
   - Resets the `feat/askstinger-*` branch to the new SHA.
   - Updates `UPSTREAM_PIN` in `sidecar/server.ts`.
   - Updates this file with the new SHA + bump date.
   - Re-runs `sidecar/__tests__` (if present) + the integration test
     in `AskStinger/Agent` that exercises the connector.
4. Never auto-merge from `unohee/OpenSwarm`. The `upstream` remote
   exists for inspection only.

## Why this file exists

Per ADR 0007's "License boundary documented in three places" clause,
AskStinger pins upstream explicitly so a runaway upstream commit can't
break the sidecar contract or introduce GPL-licensed code that crosses
the HTTP boundary. The pin SHA is also surfaced at runtime via
`/health` so AskStinger can verify what it's calling.
