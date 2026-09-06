# How the team works this repo

Written after the sprint 02 postmortem. The lead reads this before dispatching;
every agent reads `CLAUDE.md`, which points here.

## One command proves a change

`bun run verify` runs type checks, Biome, the unit suites, the extension
bundle, the test emit and the webview syntax checks. An agent runs it before
reporting and quotes its tail; a report without it is not done. `bun run
test:e2e` is CI's job unless the environment can download VS Code (allow
`update.code.visualstudio.com` in the network policy to run it locally).

## Lanes, not stages

Split work by package, not by step. A feature that touches core, CLI and the
webview is three briefs with the interface fixed up front (types, store
method names, message shapes), dispatched at the same time, each in its own
worktree (`isolation: "worktree"`). The lead merges lanes and runs `verify`
on the result. Never let two agents edit one working tree; never discard the
tree with a global checkout while a lane is open. A worktree branches from
`main` by default: tell the lane which commit to base on (the PR head) and
have it report its commit hash so the lead can cherry-pick or merge it.

A brief names: objective, the files it may touch, the interface it must
honour, the tests it must add, the verify command, and the report format.
Keep it under a screen.

## QA rides with the lane

Each implementation lane gets a tester pass on its own diff before it is
merged, and the clean-code reviewers run on the merged result. A refactor is
a lane too and gets its own tester pass; most late findings in sprint 02
came from code that was refactored after QA. The sprint-end QA block is for
what only a whole-tree pass can see (cross-package contracts, docs drift).

## Model tiers

Base tiers by default. `-deep` variants only for irreversible or
cross-cutting work (a writer over user-owned files, a policy shared by both
hosts); mechanical fix passes go to the base developer.
