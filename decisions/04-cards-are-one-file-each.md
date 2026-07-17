---
status: Accepted
date: 2026-07-16
---
# Decision 04 — Cards are one markdown file each, ordered by numeric prefix


## Context

A board needs an ordering, and cards need a stable identity that survives moving
between columns. Storing a whole board as one JSON file would make every card
edit a rewrite of the entire board and every diff noisy and conflict-prone.

## Decision

Each card is its own file, `boards/<board-id>/NN-slug.md`:

- YAML frontmatter carries the metadata — only `column` is required; `labels`,
  `priority`, `agent`, `live`, `status`, `progress`, `files`, `comments`, and
  `updatedAt` are optional. The body is `# Title`, a description, and an optional
  `## Checklist` of `- [ ]` / `- [x]` items.
- The `NN` prefix is a two-digit global order, contiguous from `01`. Dragging a
  card recomputes the order and renumbers the affected files (two-phase via temp
  names so a number swap never clobbers a sibling).
- The slug is the card's identity; the column lives in frontmatter, not in the
  file's location.

## Consequences

- Editing one card touches one small file, so diffs are tight and conflicts are
  localised.
- Reordering renames files, which shows up as renames in git history.
- Two externally-authored files can share a slug; the store detects the
  collision and refuses to reorder until it is resolved, rather than renaming one
  file over the other and destroying it.
