---
status: Accepted
date: 2026-07-16
---
# Decision 03 — Ports & Adapters around all file IO


## Context

The store needs to read and write files and to timestamp changes. If it imports
`vscode` and node's `fs` directly, it can only run inside a live extension host,
which makes it slow and awkward to test — every test would need the VS Code test
runner and a real temp directory on disk.

## Decision

The core talks to the outside world only through narrow ports. `FileSystemPort`
covers `exists` / `readFile` / `writeFile` / `listDir` / `rename` over
workspace-relative forward-slash paths; `ClockPort` provides `now()`. Nothing in
`src/core/**` imports `vscode` or a node built-in.

Adapters in `src/adapters/**` implement the ports: a Node-backed filesystem and
system clock in production, and an in-memory filesystem plus a fixed clock in
tests.

## Consequences

- The whole store is unit-testable against a virtual filesystem, with no VS Code
  host and no disk — fast and deterministic.
- Time-dependent behaviour (the `updatedAt` stamps) is controllable in tests via
  the fixed clock.
- New IO capabilities must be added to a port before the core can use them,
  which keeps the surface small and deliberate.
