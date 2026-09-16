---
column: review
updatedAt: 2026-09-06T03:58:03.088Z
labels: [core, ci, docs]
priority: high
agent: lead
status: In review
progress: 100
release: v0.9.0
effort: L
---
# Bun workspace: one core, VS Code and CLI hosts

Split the repository into a Bun workspace — `@repodoc/core` (the vscode-free
store and adapters), `@repodoc/cli` (`bunx github:flying-dice/repodoc …`), and
the `repodoc` extension — so agents and the board mutate cards through the same
store. See decisions/09-one-core-two-hosts.md and docs/03-reference/03-cli.md.

## Checklist

- [x] Workspace — `packages/core`, `packages/cli`, `packages/vscode`; Bun for install, scripts, unit tests
- [x] Core API — result-returning `moveCard`/`addCard`, `updateCardMeta`, `recordGateEvidence`
- [x] CLI — board/column/card/decision/docs/skill subcommands with gate enforcement and `--json`
- [x] Tests — core additions and an in-process CLI suite over a temp dir
- [x] Docs — README, CONTRIBUTING, architecture, development, CLI reference, changelog, skill
- [x] CI — workflows on Bun, VSIX from `packages/vscode`
- [x] QA — adversarial tester pass, clean-code audit, defects fixed

## Comments

- **lead** (2026-09-06T02:09:41.170Z): Moved the core to packages/core/src/store.ts:1 with a barrel at packages/core/src/index.ts:1; the CLI lives in packages/cli/src/commands.ts:1 and imports the core by relative path (packages/cli/src/context.ts:5) so bunx github: needs no install. Fixed a pre-existing gap where agent: was never parsed onto cards (packages/core/src/cardParse.ts:62). This card was created and moved with the new CLI.
- **lead** (2026-09-06T02:12:10.649Z): Verification: check-types, lint, 239 unit tests, extension bundle and vsce package all green locally. Not done here: the VS Code e2e suite (VS Code download reset by the sandbox proxy twice) runs in CI, and the clean-code-review gate has not been run, so the card stays in doing rather than overriding the review gates. Sprint notes in docs/bots/sprints/2026-09-06-sprint-01.md:1.
- **lead** (2026-09-06T03:58:02.914Z): Sprint 02 closed: gate/column prompts feed agents the workflow (packages/cli/src/commands.ts:1); UI parity per docs/bots/design/2026-09-06-ui-parity-sweep.md:1; Gherkin feature sets (packages/core/src/features.ts:1); Biome + super-strict TS; card ids and Copy ref; eight-principle clean-code audit and an adversarial QA pass with all 8 defects fixed (packages/core/src/frontmatter.ts:1 now round-trips unknown YAML verbatim). 584 tests green. Remaining: e2e runs in CI only; a human sets comments-addressed and peer-reviewed.

## Gates

- [x] tests-passing — bun run check-types, lint and test green: 584 unit tests, 0 skipped; e2e suites authored and run in CI (lead, 2026-09-06T03:58:02.653Z)
- [x] change-review — change-review on the staged diff plus adversarial QA (180 tests, 8 defects found and fixed in b406533) (lead, 2026-09-06T03:58:02.753Z)
- [x] clean-code-review — eight-principle clean-code audit run; every finding above 0.5 fixed (commit e16d4b6); no TODO: clean-code markers (lead, 2026-09-06T03:58:02.701Z)
