# File formats

This is the exact on-disk schema RepoDoc reads and writes. It is the same format
the extension's core parses — the parsers live in `src/core/` (`frontmatter.ts`,
`cardParse.ts`, `boardConfig.ts`, `decisions.ts`, `docs.ts`).

## Board config — `boards/<board-id>/.config.json`

```json
{
  "name": "RepoDoc",
  "columns": [
    { "id": "backlog", "name": "Backlog", "color": "#7d828b" },
    { "id": "doing", "name": "In Progress", "color": "#5cd68a", "wip": 3 }
  ],
  "labels": {
    "core": { "name": "core", "color": "#3fb27f" }
  },
  "agents": {
    "claude": { "name": "Claude", "color": "#d97757", "initials": "CL" }
  }
}
```

- `columns` is an ordered list; each needs an `id`, and may set `name`, `color`,
  and an optional `wip` limit. A column with no `name` falls back to a
  title-cased `id`.
- `labels` and `agents` are keyed maps. An entry that is null or carries no
  string field is dropped, so a stray `"claude": null` never reaches the UI.

## Card — `boards/<board-id>/NN-slug.md`

```md
---
column: doing
labels: [core, webview]
priority: high
agent: claude
updatedAt: 2026-07-17T12:00:00.000Z
---
# Card title

A sentence or two of description.

## Checklist

- [x] A finished step
- [ ] A step still to do
```

- Only `column` is required. Optional frontmatter: `labels` (inline array),
  `priority` (`high` | `med` | `low`), `agent`, `live` (boolean), `status`,
  `progress` (number), `comments` (number), `updatedAt`
  (ISO string).
- The body's first `# ` heading is the title. Everything between the title and a
  `## Checklist` heading is the description. Checklist items are `- [ ]` /
  `- [x]`.
- `NN` is a two-digit global order, contiguous from `01`; the slug after it is
  the card's identity. Frontmatter uses a small YAML subset — `key: value`
  pairs, inline `[a, b]` arrays, strings, numbers, and booleans.

## Decision — `decisions/NN-slug.md`

```md
# Decision NN — Title

**Status:** Accepted &nbsp;·&nbsp; **Date:** 2026-07-17

## Context

## Decision

## Consequences
```

The `**Status:**` line drives the badge (`Proposed` | `Accepted` | `Superseded`).
Records are ordered by their numeric prefix.

## Docs — `docs/NN-folder/NN-slug.md`

Plain markdown. Folders become collapsible sidebar sections and files become
pages; a leading `NN-` numeric prefix orders both, and the first `# ` heading is
the sidebar label (falling back to the title-cased file name).
