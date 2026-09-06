# File formats

This is the exact on-disk schema RepoDoc reads and writes. It is the same format
the extension's core parses — the parsers live in `packages/core/src/`
(`frontmatter.ts`, `cardParse.ts`, `boardConfig.ts`, `decisions.ts`, `docs.ts`,
`featureParse.ts`) and the writers beside them (`cardBody.ts`, `featureBody.ts`).

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
  `name` falls back to a title-cased `id`. A board whose `.config.json` is
  missing, unparsable, or declares no usable column falls back to the default
  columns so its cards stay visible; `repodoc board show` says so on stderr.
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
`label`, an optional `prompt`, and exactly one of two kinds:

- **script** — `script` names a command (e.g. `"npm test"`) that must have run
  green. Evidence-based: satisfied by a done line for the gate id in the card's
  `## Gates` section; the extension does not execute it.
- **field** — `field` names a field id (custom or reserved) evaluated live
  against the card's frontmatter. An optional `check` expression constrains the
  value; absent, it means "non-empty".

```json
"prompt": "Set live false and progress 100, then journal what shipped.",
"enter": [
  {
    "id": "tests-passing",
    "script": "bun run test",
    "label": "All tests passing",
    "prompt": "Run `bun run test` from the repo root. Only when it exits 0, record the summary with `repodoc card gate-pass`."
  },
  { "id": "peer-review", "field": "peer-reviewed", "check": "= true", "label": "Peer reviewed" }
]
```

**Prompts are the workflow.** A gate's `prompt` tells whoever must satisfy it
what to read, run, or record; a column's `prompt` says what working in that
column means. The CLI prints every failing gate's prompt when it refuses a move
and the target column's prompt when a move succeeds, so an agent is handed the
process rather than just a "no". A gate without a prompt gets a generated one
naming its script (or, for a script gate with no command, the gate id) or field.
A gate whose `script` is empty or whitespace is dropped when the config is read
— a gate that requires running nothing can never be satisfied by running
anything — as is a gate whose `id` repeats an earlier gate in the same
`enter`/`exit` list.

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
  pairs, inline `[a, b]` arrays, strings, numbers, and booleans. Anything else in
  the block (a key whose value continues on indented lines, `#` comments, blank
  lines) is not understood but IS preserved: it is written back byte-for-byte,
  and a `key: value` line RepoDoc did not change keeps its exact original text.
  An opening `---` block that declares no key at all is a horizontal rule in the
  body, not frontmatter, so the prose under it is never consumed.
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

**Line endings are yours.** Every write detects the file's dominant line ending
(CRLF or LF) and re-emits it, so editing a card, a decision, or a feature never
converts the file and never turns a one-line change into a whole-file diff.

  A human override is recorded on the same line as
  `OVERRIDDEN (<who>, <ISO time>): <reason>`, keeping the bypass and its
  justification visible in the diff.
- **Comments** are a `## Comments` work journal — one bullet per entry, oldest
  first, formatted `- **<who>** (<ISO time>): <text>`. A `path:line` or
  `path:start-end` token in the text (e.g. `src/core/store.ts:123`,
  `src/panels/boardPanel.ts:40-60`) renders as a one-click link that opens the
  file at that highlighted range:

  ```md
  ## Comments

  - **claude** (2026-07-17T11:40:00.000Z): Added the export endpoint in src/export/router.ts:22-49 and covered it in src/export/router.test.ts:1-40.
  ```

## Features — `features/<set-id>/`

A feature set is a folder of Gherkin `.feature` files that renders on the same
kanban surface as a board:

```
features/repodoc/
  .config.json          # same shape as a board config
  gates-block-a-move.feature
  cli-refuses-a-gated-move.feature
```

`.config.json` uses the **same schema as a board config** (`name`, `columns`
with `id`/`name`/`color`/`wip`/`prompt`, and optionally `labels` / `fields`) and
is normalized by the same code. Column `enter`/`exit` gates may be present but
are **NOT enforced for features** in this iteration — `repodoc feature move`
never evaluates them.

A feature's column is a tag on the Feature's tag line:

```gherkin
@status:specified @core
Feature: Gates block a move

  A card may not enter a column whose enter gates fail.

  Scenario: The move is refused
    Given a card in "todo" and a failing enter gate on "review"
    When I move the card to "review"
    Then the move is refused with the gate's prompt
```

- `@status:<columnId>` names the column. Absent, or naming a column the set does
  not declare, the feature falls into the **first** column, so no feature is ever
  invisible.
- Moving a feature rewrites **only** that tag — in place when it exists,
  otherwise as a new tag line immediately above `Feature:`. Every other byte is
  preserved and the file is **never renamed or renumbered**: test runners
  reference feature files by path.
- Order inside a column is file-name order.
- A feature's id is its file name without `.feature`.

On the board, a feature's card shows the text after `Feature:` as its title, its
non-`@status:` tags as labels, the free text under `Feature:` as its description,
and every `Scenario:` / `Scenario Outline:` / `Scenario Template:` / `Example:`
with its steps. Features have no checklist, comments, custom fields, or gate
evidence, so the webview hides those affordances.

### Managed edits

The title, the description and the scenarios are editable from the card view and
from the CLI (`feature rename`, `feature describe`, `feature scenario-add` /
`scenario-set` / `scenario-remove`). Both hosts go through the same writers, and
those writers rewrite ONE construct at a time:

| Edit | What is rewritten |
| --- | --- |
| Title | the name on the `Feature:` line (a file without one gets a `Feature:` line below its tags) |
| Description | the lines between `Feature:` and the first tag or keyword line (refused when the file has no `Feature:` line — rename it first, which writes one) |
| Scenario name | the text after the keyword on that scenario's heading line |
| Scenario steps | the body lines under that heading, down to the blank line before the next block |
| Add scenario | a new block appended at the end of the file |
| Remove scenario | that block and the tag lines directly above it |

Everything else is preserved byte for byte: feature and scenario tags (including
`@status:`), `Rule:` and `Background:` blocks, comments, indentation (a block is
rewritten at the indentation it was found at) and the file's own line endings — a
CRLF file stays CRLF. Scenario indexes count only scenarios, so a `Rule:` or a
`Background:` can never be addressed, let alone overwritten, by a scenario edit.

A scenario's body — steps, doc strings, tables and an outline's `Examples:` — is
carried verbatim and never interpreted. It is shown in full when the scenario is
edited and written back as given, which is why a managed edit cannot silently
discard the Gherkin RepoDoc does not model: nothing is hidden from the editor,
and only what the editor was shown is replaced. Titles and scenario names are
collapsed to a single line so they cannot forge a second `Feature:` line, a
`@status:` tag, or a step.

A doc string — a block opened and closed by `"""` or ``` ``` ```, at any
indentation, optionally with a media type after the opening delimiter
(`"""json`) — is payload, not structure. Everything inside one is text, so a
`Scenario:`, `Feature:`, `Rule:`, `Examples:`, `@tag`, `#` comment or `| table |`
line in there never starts a scenario, never ends a description and never
attaches a tag. It belongs to the step above it: it is shown with that
scenario's body, replaced with it, and removed with it — whole, delimiters
included. A doc string left unclosed runs to the end of the file and is treated
the same way, as content.

Scenario TAGS are shown but not editable, and `Rule:` / `Background:` blocks are
not shown at all: for those, and for anything else, **Open file** in the card
view (or a feature in the Boards tree) opens the `.feature` itself.

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
