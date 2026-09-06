---
status: Accepted
date: 2026-09-06
---
# Decision 10 — Gherkin feature sets on the kanban surface, status as a tag

## Context

Teams that write behaviour as Gherkin want to see where each feature stands
(proposed, specified, implemented, verified) next to the work cards, and they
want agents to move features through those states the same way they move cards.
Feature files are owned by the test runner: their paths, order and content mean
something to Cucumber, so RepoDoc must not rename, renumber or pollute them.

Two places to keep a feature's status were considered: a tag inside the
`.feature` file, or a sidecar `<file>.feature.md` with frontmatter that could
also carry gate evidence and a journal (the designer's recommendation in
`docs/bots/design/2026-09-06-ui-parity-sweep.md`, section 4).

## Decision

- A **feature set** is a folder `features/<set-id>/` with a `.config.json` in the
  same shape as a board config (`name`, `columns` with `prompt`) and any number of
  standard `.feature` files.
- A feature's status is a **tag on its Feature line**: `@status:<columnId>`.
  Absent or unknown → the set's first column. Moving a feature rewrites only
  that tag; nothing else in the file changes, and files are never renamed. Order
  within a column is file-name order; there is no drop index.
- Feature sets render on the **same kanban surface** as boards through a
  `BoardSource` abstraction in the extension. A feature card shows the feature
  title, its non-status tags as labels, and its description plus a scenario list.
  Comments, checklist, custom fields and add-column are switched off for feature
  sets via a `capabilities` flag in the webview payload.
- Column **gates are not enforced** for feature sets in this iteration: there is
  no honest place in a `.feature` file to record evidence.
- The CLI grows a `feature` group (`sets`, `set-create`, `list`, `show`,
  `create`, `move`) with the same `--json` and prompt behaviour as `card`.

The sidecar design is deferred, not rejected. If feature-level gates or a
journal are wanted, a `<file>.feature.md` sidecar can be added without
changing where the status lives.

## Addendum — managed editing (0.9.0)

The first iteration made a feature's content read-only in RepoDoc: the board
showed it and *Open file* was the only way to change it. It is now editable —
the `Feature:` line, the free text under it, and each scenario's name and body —
from both the card view and the CLI (`feature rename|describe|scenario-add|
scenario-set|scenario-remove`).

This does not move where anything lives. The `.feature` file remains the single
source of truth and is still never renamed. Every managed edit rewrites ONLY the
construct it names, measured as a line span by the parser that rendered it, so
what the editor showed is exactly what the save replaces: tags (including
`@status:`), `Rule:` and `Background:` blocks, comments, indentation and the
file's line endings are preserved byte for byte, and a scenario's steps, doc
strings and `Examples:` are carried verbatim rather than interpreted. Scenario
tags stay read-only in the UI, and *Open file* stays the escape hatch for them
and for any Gherkin the UI does not render.

The sidecar is still deferred: nothing here needs one.

## Consequences

- Feature files stay valid, runnable Gherkin; the only RepoDoc footprint is one
  tag, which cucumber tools can filter on (`--tags "@status:verified"`).
- No renumbering means no two-phase renames and no drop-position UI for
  feature sets; the board must not promise an order it will not keep.
- Gate prompts on feature-set columns still print on `feature move` (the column
  `prompt`), so the workflow guidance reaches agents even though enforcement does not.
