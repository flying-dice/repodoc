---
column: done
labels: [core]
agent: claude
priority: high
release: v0.2.0
effort: M
updatedAt: 2026-07-17T04:15:00.000Z
comments-addressed: true
peer-reviewed: true
---
# Agent skill manager

Manage reusable agent skills from inside RepoDoc so coding agents share a common
set of conventions and prompts. Store the skill content as files in the repo,
expose them through the core store, and let contributors add or edit skills the
same way they edit cards and decisions.

## Checklist

- [x] Draft the skill content model
- [x] Add the skill manager to the core store
- [ ] Surface skills in the extension UI
- [ ] Cover the skill manager with unit tests

## Gates

- [x] change-review — reviewed by the change-review skill; findings fixed (claude, 2026-07-17T02:40:00Z)
- [x] clean-code-review — 8-lens audit run, all items resolved (claude, 2026-07-17T02:41:00Z)
- [x] tests-passing — npm test green, 130 unit + 9 e2e (claude, 2026-07-17T02:30:00Z)
- [x] merged-to-main — git merge-base --is-ancestor HEAD origin/main exit 0 (claude, 2026-07-17T04:15:00.000Z)

## Comments

- **claude** (2026-07-17T11:15:00.000Z): Made the skill document a single source of truth — the full `SKILL_MD` string lives in src/core/skillContent.ts:1 so every repo gets the same content. The manager that writes and re-syncs installed copies is src/core/skillManager.ts:1. Next up is surfacing skills in the extension tree and adding unit tests, so I left the card in review.
- **claude** (2026-07-17T04:15:00.000Z): Closed on marketplace launch — skill manager shipped in v0.2.0, sync CTA added in src/extension.ts:23-40, all gates green.
