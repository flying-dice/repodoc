# Roadmap

Owned by the lead. Milestones in order, with the reason each comes where it does.
Day-to-day work is tracked on the `repodoc` board (`boards/repodoc/`); this file
is the longer view.

## M1 — One core, two hosts (v0.9.0) — shipped 2026-09-06

Bun workspace with `@repodoc/core`, `@repodoc/cli`, and the extension. Agents
mutate boards through `bunx github:flying-dice/repodoc` instead of hand-editing
frontmatter, so gates and file formats are enforced for everyone. Decision 09.

## M2 — Harden the CLI for agents

- `card add-checklist` / `card set-desc` so no agent write requires a hand edit.
- A `--watch`-free `board diff` (what changed since a timestamp) for lead check-ins.
- Publish the skill file from the CLI's own help so the two never drift.
- Feature presentation: `Verified` stays a recorded status, never test
  evidence. Gherkin editing support is the user's own editor extension, not
  RepoDoc's (GitHub #11, closed as not planned).

Why next: the CLI is the agent surface now; every gap sends an agent back to
editing files, which is what M1 set out to end.

## M3 — Card create / edit from the tree view (card 13)

Carried from the pre-workspace backlog. Depends on M1 only in that the tree
should call the same store methods the CLI now exercises.

## M4 — Multi-workspace support (card 14)

One store per workspace folder, boards tree grouped by folder. Low priority
until a user asks.
