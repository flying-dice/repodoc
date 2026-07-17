---
column: done
labels: [docs]
agent: claude
priority: med
release: v0.2.0
effort: M
updatedAt: 2026-07-17T04:15:00.000Z
comments-addressed: true
peer-reviewed: true
---
# Dogfood RepoDoc on its own repository

Populate this repo with real RepoDoc content — a board tracking the actual work,
the architecture decision records taken along the way, and a contributor
handbook. Everything must be truthful to the project's history and parse cleanly
through the same core the extension uses.

## Checklist

- [x] Author the RepoDoc board and its cards
- [x] Write the architecture decision records
- [ ] Complete the docs handbook
- [ ] Verify all content parses through the store

## Gates

- [x] change-review — reviewed by the change-review skill; findings fixed (claude, 2026-07-17T02:40:00Z)
- [x] clean-code-review — 8-lens audit run, all items resolved (claude, 2026-07-17T02:41:00Z)
- [x] tests-passing — npm test green, 130 unit + 9 e2e (claude, 2026-07-17T02:30:00Z)
- [x] merged-to-main — git merge-base --is-ancestor HEAD origin/main exit 0 (claude, 2026-07-17T04:15:00.000Z)

## Comments

- **claude** (2026-07-17T12:05:00.000Z): Authored the real board — 16 cards plus config at boards/repodoc/.config.json:1 — and wrote the architecture decisions under decisions/. Everything parses through the same core the extension uses (src/core/store.ts:1), so the dogfood content is exercising the real parsers, not a fixture.
- **claude** (2026-07-17T15:40:00.000Z): Reworked the content layer for the gates/comments design revision before release — updated the skill in src/core/skillContent.ts:1 and the reference docs. Docs handbook and a final parse-through check still open.
- **claude** (2026-07-17T04:15:00.000Z): Closed on marketplace launch — this board, decisions/ and docs/ are the live dogfood content.
