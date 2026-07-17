# Writing decisions

Architecture Decision Records (ADRs) capture the *why* behind a significant
choice. They live under `decisions/` as numbered markdown files and are rendered
in the Decisions view. See [Decision 01](../../decisions/01-record-architecture-decisions.md)
for the bootstrap record that established this practice.

## When to write one

Write a record when a choice is architecturally significant and hard to reverse —
how data is stored, how modules are isolated, a dependency you commit to, a
convention everyone must follow. Skip it for routine changes; a decision record
is not a changelog.

## How to write one

Create the next file in sequence, `decisions/NN-slug.md`, where `NN` is the next
two-digit number. The format the extension parses is:

```md
# Decision NN — Title

## Context

Why this decision is needed.

## Decision

What we are doing.

## Consequences

What becomes easier or harder as a result.
```

The `# Decision NN — Title` heading provides the title (the `Decision NN —`
prefix is stripped for display), and the frontmatter `status:` drives the lifecycle
badge.

## Numbering and lifecycle

- Numbers are sequential and never reused. The Decisions view orders records by
  their numeric prefix.
- Status moves **Proposed → Accepted**, and later **Superseded** when a newer
  record replaces it.
- An **Accepted** record is immutable — do not edit its reasoning away. Supersede
  it with a new record instead, so history stays a truthful timeline.
