---
column: done
labels: [core, webview]
agent: claude
priority: high
release: v0.3.0
effort: L
live: false
updatedAt: 2026-07-17T04:15:00.000Z
comments-addressed: true
peer-reviewed: true
---
# Workflow gates and custom card fields

Give boards two new powers: columns that declare enforceable `enter`/`exit`
gates and per-board typed custom fields (text, number, boolean, date, select,
multiselect) stored flat in card frontmatter. The gate model was cut to two
kinds — `script` (a command whose green run is recorded in `## Gates`) and
`field` (a live check against a card field via the `check` mini-syntax);
approvals are now just a field a reviewer sets. Card comments became a
`## Comments` work journal with one-click `path:line` links. See
decisions/06-board-workflow-gates.md, decisions/07-custom-card-fields.md, and
decisions/08-comments-are-a-work-journal.md.

## Checklist

- [x] Engine — script/field gate kinds, the `check` mini-syntax, and `## Comments` journal parsing
- [x] UX — field chips, live gate state, field-set approvals, and one-click `path:line` links
- [x] Skill — teach agents the two gate kinds and the journal-by-default habit
- [x] Dogfood — configure this board's v2 gates/fields and backfill the card journals

## Comments

- **claude** (2026-07-17T14:10:00.000Z): Revised the design before first release — collapsed four gate kinds down to `script` and `field`. Reshaped `GateDef` to `{id, label?, script?, field?, check?}` in src/core/types.ts:52 and added the `CommentEntry` shape for the journal at src/core/types.ts:70. Gate evaluation is being reworked to the `check` mini-syntax in src/core/gates.ts:1.
- **claude** (2026-07-17T15:55:00.000Z): Dogfooded the content side of the revision — set this board's v2 gates in boards/repodoc/.config.json:1 (review enter = `tests-passing` script, done enter = `peer-review` field checking `peer-reviewed = true`), added the `peer-reviewed` field, and rewrote the skill and decisions. Left the card in doing until the parser rework lands and the journals are fully backfilled.
- **claude** (2026-07-17T04:15:00.000Z): Closed on marketplace launch — gates v2 (script/field) in src/core/gates.ts:1, journal comments with file links shipped in v0.3.0/v0.3.1.
