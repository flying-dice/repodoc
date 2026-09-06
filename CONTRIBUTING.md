# Contributing

## Setup

Install [Bun](https://bun.sh) (1.1+) and Node 20+ (for the VS Code host), then:

```sh
bun install
```

Press `F5` in VS Code for an Extension Development Host running the extension
from `packages/vscode`.

## Layout

This is a Bun workspace:

- `packages/core` — `@repodoc/core`, the vscode-free store and adapters. Pure
  TypeScript over a filesystem port. Unit-tested with `bun test`.
- `packages/cli` — `@repodoc/cli`, `repodoc <group> <command>`. Zero runtime
  dependencies and imports the core by relative path so
  `bunx github:flying-dice/repodoc` works from a bare checkout.
- `packages/vscode` — the extension: trees, webview panels, watchers. Bundled
  with esbuild, packaged with `vsce`.

## Commands (from the repo root)

| Command | What it does |
| --- | --- |
| `bun run check-types` | `tsc --noEmit` in every package |
| `bun run lint` | Biome (lint + format check + import sorting) over the whole repo |
| `bun run lint:fix` | Biome with its safe fixes applied |
| `bun run format` | Biome formatter only |
| `bun test packages/core packages/cli packages/vscode/test/unit` (or `bun run test`) | Unit suites on the in-memory filesystem and a temp dir |
| `bun run test:e2e` | The VS Code end-to-end suite (downloads VS Code; CI runs it under `xvfb-run`) |
| `bun run compile` / `bun run watch` | Bundle the extension to `packages/vscode/dist` |
| `bun run vsix` | Production bundle + `vsce package` into `packages/vscode/*.vsix` |
| `bun run repodoc -- <command>` | Run the CLI from this checkout |

`bun run lint` and `bun run check-types` must both be clean before pushing. The
packages compile under a strict TypeScript configuration (`strict` plus
`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitReturns`,
`noPropertyAccessFromIndexSignature`, and friends) — narrow with real checks
rather than silencing a diagnostic with `!` or a cast.

## Where to put things

Push logic into `packages/core` so it is covered by a unit test on the virtual
filesystem and is automatically available to both hosts. The CLI and the
extension should stay thin: parse input, call the store, render output. The
CLI may not take a runtime dependency (see
`decisions/09-one-core-two-hosts.md`).

## Releases

Pushing a `v*` tag builds the VSIX in CI and attaches it to a GitHub release.
The CLI needs no release: `bunx github:flying-dice/repodoc` runs `main`.
