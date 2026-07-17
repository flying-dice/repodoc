---
status: Accepted
date: 2026-07-15
---
# Decision 01 — Record architecture decisions


## Context

RepoDoc makes architecturally significant choices regularly — how data is
stored, how the core is isolated, how cards are identified. Left in commit
messages and chat threads, the reasoning behind those choices is hard to find
later, and new contributors (human or agent) have no single place to learn why
the system is shaped the way it is.

## Decision

We will keep a collection of Architecture Decision Records under `decisions/`.
Each record is a numbered markdown file (`NN-slug.md`) describing one decision,
its context, and its consequences. The `# Decision NN — Title` heading and the
frontmatter `status:` are the format the extension parses to render and badge each
record.

- Records are numbered sequentially and never renumbered.
- A record is immutable once **Accepted** — we supersede it with a new record
  rather than editing the reasoning out of history.
- Agents are instructed to read the relevant decisions before starting related
  work.

## Consequences

- The reasoning behind decisions becomes durable, diffable, and searchable.
- There is a small ongoing cost to writing a record for each significant choice.
- Superseded records stay in history, giving a timeline of how the design
  evolved.
