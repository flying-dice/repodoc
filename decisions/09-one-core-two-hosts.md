---
status: Accepted
date: 2026-09-06
---
# Decision 09 — One core, two hosts: VS Code and a CLI over the same store

## Context

Coding agents work RepoDoc boards by editing card files by hand. That works, but
every agent re-implements the same rules — slug derivation, renumbering, gate
evaluation, the comment and gate line formats — and gets some of them subtly
wrong. The extension already had all of that logic in a vscode-free core behind
a filesystem port (Decision 03). The missing piece was a second host.

## Decision

The repository becomes a Bun workspace with three packages:

| Package | Path | Role |
| --- | --- | --- |
| `@repodoc/core` | `packages/core` | The store, parsers, gates, and the Node / in-memory adapters. No `vscode`. |
| `@repodoc/cli` | `packages/cli` | `repodoc <group> <command>` — the same store operations from a terminal. |
| `repodoc` (extension) | `packages/vscode` | Trees, webviews, watchers. Consumes `@repodoc/core` via a workspace link. |

Both hosts drive the identical `RepoDocStore` over a `NodeFileSystemAdapter`:

```
VS Code ─┐
         ├─▶ @repodoc/core (RepoDocStore) ─▶ FileSystemPort ─▶ boards/ decisions/ docs/
CLI ─────┘
```

The CLI is invoked as `bunx github:flying-dice/repodoc <command>`. To make that
work from a bare git checkout with no install step, the root `package.json`
declares the bin and the CLI has **zero runtime dependencies**: it imports the
core by relative path (`../../core/src`) rather than by package name, and Bun
executes the TypeScript directly. Argument parsing is hand-rolled for the same
reason.

Bun replaces npm for installing, scripting, and running unit tests (`bun test`).
The extension still bundles with esbuild and packages with `vsce --no-dependencies`
(everything it needs is bundled). Its end-to-end suite still runs on
`@vscode/test-cli`.

Store mutations that used to fail silently (`moveCard`, `addCard`) now return a
result object so the CLI can exit non-zero with a reason; the extension ignores
the return value and behaves as before. `updateCardMeta` and `recordGateEvidence`
were added so agents no longer edit frontmatter or `## Gates` lines by hand.

## Consequences

- Agents and humans mutate boards through one code path. The skill tells agents
  to prefer the CLI; hand-editing remains valid because the files are the truth.
- Gates are enforced for agents too: `card move` refuses a move whose gates fail
  unless `--override` is passed, which records the override exactly as the UI does.
- The CLI cannot take a dependency without breaking `bunx github:` installs.
  Anything it needs beyond the core must be written in-tree.
- Contributors need Bun. Node stays a requirement only for the VS Code host.
