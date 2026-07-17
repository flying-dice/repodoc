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
  }
}
```

- `columns` is an ordered list; each needs an `id`, and may set `name`, `color`,
  an optional `wip` limit, and `enter`/`exit` gates (see below). A column with no
  `name` falls back to a title-cased `id`.
- `labels` is a keyed map. An entry that is null or carries no string field is
  dropped, so a stray `"core": null` never reaches the UI.
- `fields` is an ordered list of custom card-field definitions (see below).

### Custom fields — `fields`

A board may declare extra typed card fields. Each definition carries an `id`
(the frontmatter key), an optional `label`, a `type`, `options` for the two
select kinds, and an optional `showOnCard` to render the value as a chip on the
card face:

```json
"fields": [
  { "id": "release", "label": "Release", "type": "select",
    "options": ["v0.1.0", "v0.2.0", "v0.3.0"], "showOnCard": true },
  { "id": "effort", "label": "Effort", "type": "select", "options": ["S", "M", "L"] }
]
```

`type` is one of `text`, `number`, `boolean`, `date`, `select`, or `multiselect`.
A field `id` must not collide with a reserved card key (`column`, `labels`, and
so on). A `select` value that is not among `options` is preserved and flagged as
unknown, never dropped.

### Gates — `enter` / `exit`

A column may gate transitions. `enter` gates must pass to move a card INTO the
column; `exit` gates must pass to move it OUT. Each gate has an `id`, an optional
`label`, and exactly one of two kinds:

- **script** — `script` names a command (e.g. `"npm test"`) that must have run
  green. Evidence-based: satisfied by a done line for the gate id in the card's
  `## Gates` section; the extension does not execute it.
- **field** — `field` names a field id (custom or reserved) evaluated live
  against the card's frontmatter. An optional `check` expression constrains the
  value; absent, it means "non-empty".

```json
"enter": [
  { "id": "tests-passing", "script": "npm test", "label": "All tests passing" },
  { "id": "peer-review", "field": "peer-reviewed", "check": "= true", "label": "Peer reviewed" }
]
```

**Approvals are field gates** — a review sign-off is just a field a reviewer
sets, checked with `= <name>`. The `check` mini-syntax:

| `check`         | passes when                                    |
| --------------- | ---------------------------------------------- |
| *(absent)*      | the field is non-empty                         |
| `empty`         | the field is empty / unset                     |
| `nonempty`      | the field has any value                        |
| `= v`           | the value equals `v`                           |
| `!= v`          | the value does not equal `v`                   |
| `> n` / `>= n`  | numeric greater-than / greater-or-equal `n`    |
| `< n` / `<= n`  | numeric less-than / less-or-equal `n`          |
| `contains v`    | the value (or a multiselect item) contains `v` |
| `match <regex>` | the value matches the regular expression       |

## Card — `boards/<board-id>/NN-slug.md`

```md
---
column: doing
labels: [core, webview]
priority: high
updatedAt: 2026-07-17T12:00:00.000Z
---
# Card title

A sentence or two of description.

## Checklist

- [x] A finished step
- [ ] A step still to do
```

- Only `column` is required. Optional frontmatter: `labels` (inline array),
  `priority` (`high` | `med` | `low`), `live` (boolean), `status`,
  `progress` (number), `updatedAt` (ISO string). There is no `comments`
  frontmatter key — comments are a `## Comments` body section (below), and the
  count badge is derived from its entries.
- The body's first `# ` heading is the title. Everything between the title and
  the first `## Checklist` / `## Gates` / `## Comments` heading is the
  description. Checklist items are `- [ ]` / `- [x]`.
- `NN` is a two-digit global order, contiguous from `01`; the slug after it is
  the card's identity. Frontmatter uses a small YAML subset — `key: value`
  pairs, inline `[a, b]` arrays, strings, numbers, and booleans.
- **Custom-field values** are flat frontmatter keys, one per board-defined field
  id, typed by the def: `release: v0.2.0` (select), `estimate: 5` (number),
  `blocked: true` (boolean), `due: 2026-07-20` (date), `areas: [core, ci]`
  (multiselect, inline-array form).
- **Gate evidence** lives under a `## Gates` heading as task-list items, one per
  satisfied **script** gate, formatted `- [x] <gateId> — <note> (<who>, <ISO time>)`.
  Field gates need no evidence line — they evaluate live from frontmatter:

  ```md
  ## Gates

  - [x] tests-passing — npm test green, 130 unit + 9 e2e (claude, 2026-07-17T02:30:00Z)
  ```

  A human override is recorded on the same line with `OVERRIDDEN` and their name,
  keeping the bypass visible in the diff.
- **Comments** are a `## Comments` work journal — one bullet per entry, oldest
  first, formatted `- **<who>** (<ISO time>): <text>`. A `path:line` or
  `path:start-end` token in the text (e.g. `src/core/store.ts:123`,
  `src/panels/boardPanel.ts:40-60`) renders as a one-click link that opens the
  file at that highlighted range:

  ```md
  ## Comments

  - **claude** (2026-07-17T11:40:00.000Z): Added the export endpoint in src/export/router.ts:22-49 and covered it in src/export/router.test.ts:1-40.
  ```

## Decision — `decisions/NN-slug.md`

```md
# Decision NN — Title

## Context

## Decision

## Consequences
```

Frontmatter `status:` drives the badge (`Proposed` | `Accepted` | `Superseded`); `date:` is shown in the rendered view.
Records are ordered by their numeric prefix.

## Docs — `docs/NN-folder/NN-slug.md`

Plain markdown. Folders become collapsible sidebar sections and files become
pages; a leading `NN-` numeric prefix orders both, and the first `# ` heading is
the sidebar label (falling back to the title-cased file name).
