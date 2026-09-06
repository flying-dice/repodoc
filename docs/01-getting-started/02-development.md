# Development

RepoDoc is a Bun workspace holding a vscode-free core, a CLI, and an
esbuild-bundled VS Code extension. You need Bun 1.1+, Node 20+, and VS Code
1.100 or newer.

## Set up and run

```sh
bun install
```

Press `F5` in VS Code to launch an Extension Development Host with RepoDoc
loaded from `packages/vscode`. Open any folder in that window, click the RepoDoc
icon in the activity bar, and hit **Initialize RepoDoc** to seed a starter board.

To try the CLI from this checkout:

```sh
bun run repodoc -- board list
bun packages/cli/src/bin.ts card show project-backlog 01-try-dragging-this-card
```

## Scripts

All run from the repository root.

| Command | What it does |
| --- | --- |
| `bun run check-types` | Type-checks every package |
| `bun run lint` | Biome: lint, format check, and import sorting across the repo |
| `bun run lint:fix` | Biome with its safe fixes applied (`biome check --write`) |
| `bun run format` | Biome formatter only (`biome format --write`) |
| `bun run test` | Unit suites: core (in-memory FS), CLI (temp dir), and the extension's pure helpers |
| `bun run test:e2e` | Drives the real extension in a VS Code host (`xvfb-run -a` on Linux) |
| `bun run compile` | Type-checks and bundles the extension to `packages/vscode/dist/extension.js` |
| `bun run watch` | esbuild watcher for the extension |
| `bun run vsix` | Production bundle and `vsce package --no-dependencies` |

`bun run lint` and `bun run check-types` must both exit clean before pushing.

## Testing

Unit tests live next to each package under `test/`. The core suite runs the
store against the in-memory filesystem adapter — fast and deterministic. The CLI
suite runs commands in-process against a temp directory and asserts on both the
output and the files written. End-to-end tests under `packages/vscode/test/e2e`
drive the activated extension through the VS Code test runner.

When adding a feature, put the logic in `packages/core` so one unit test covers
both hosts; keep the CLI and extension to input parsing and rendering.
