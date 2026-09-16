# RepoDoc — agent notes

Task boards, decision records, docs and Gherkin feature sets stored as plain
files, with a VS Code extension and a CLI over one core. Read
`docs/01-getting-started/03-architecture.md` for the shape and
`decisions/09-one-core-two-hosts.md`, `decisions/10-*.md` for the rules.

## Layout

- `packages/core` — `@repodoc/core`: store, parsers, gates, adapters. No `vscode`,
  no node built-ins; storage only through `FileSystemPort`.
- `packages/cli` — `repodoc <group> <command>`. Zero runtime deps; imports core by
  relative path so `bunx github:flying-dice/repodoc` runs from a bare checkout.
- `packages/vscode` — the extension. Webview is hand-written ES5 in
  `media/board.js`; message shapes are mirrored by hand from
  `src/panels/protocol.ts` and validated in `boardPanel.ts` before use.
- Data this repo dogfoods: `boards/`, `features/`, `decisions/`, `docs/`.
  Team memory: `docs/bots/` (roadmap, sprints, design reviews).

## Verify before every report and push

```
bun run verify
```

That is type checks (3 packages, super-strict, 0 diagnostics), Biome, the
unit suites, the extension bundle, the test emit and the webview syntax
checks, fail-fast. Quote its tail in your report. `bun run test:e2e` drives a
real VS Code; CI runs it under xvfb, and it runs locally only when the
environment can reach `update.code.visualstudio.com`. Author e2e tests so
they type-check and compile.

## How work is split

Read `docs/bots/PROCESS.md`: one lane per package in its own worktree, the
interface fixed in the brief, QA on each lane before merge.

## Conventions that bite

- Every file edit preserves all other bytes and the file's EOL. Edit a span,
  never rewrite a file. Core helpers: `cardBody.ts`, `featureBody.ts`,
  `frontmatter.ts` (keeps unknown YAML verbatim), `eol.ts`.
- Core never throws on expected input: return `false` or a result object.
- Gates are enforced only through `moveCardGated`; both hosts call it.
  Feature sets do not enforce gates (Decision 10).
- Feature files are never renamed; status is the `@status:<column>` tag.
- Anything written to frontmatter or a body section is collapsed to one line
  where the format demands it (authors, gate ids, titles, labels).
- Tests import `describe`/`test` from `bun:test`; use `required()` from
  `packages/core/test/helpers.ts` instead of `!`.
- Keep `media/board.js` ES5 (Biome has an override); extract pure logic into a
  vscode-free module beside `gateGuidance.ts` and mirror-test it.

## Working the board

Use the CLI, not hand edits: `bun packages/cli/src/bin.ts card …`. A refused
`card move` prints each failing gate's prompt — follow it. Record evidence
with `card gate-pass`; never `--override` without a human's say-so.
