---
status: Proposed
date: 2026-09-20
---
# Decision 11 — The reading view's parser owns markdown structure; the diff owns policy

## Context

The `HEAD → working tree` diff (Decision 09's reading views, shipped in 0.9.0)
compared documents with a markdown classifier written for the purpose: a block
splitter with its own fence rules, list-marker regular expressions, tab-stop
arithmetic, an indentation stack and a paragraph-state machine, followed by a
hand-written longest-common-subsequence.

It was a second markdown parser, and it disagreed with the real one. Every
defect found in it was the same defect wearing different clothes — a rule that
decided what owned a line, contradicting what the reading view's own parser had
already decided:

- code that begins with `-` read as a list, collapsing the literal it contained;
- a child list's margin never restored on the way back to its parent;
- a lazy continuation treated as a return to the parent, orphaning the fence
  below it;
- literal backticks in indented code opening a document fence that swallowed
  the rest of the file, reference definitions included.

Each fix satisfied its own reproduction and produced the next defect, because
the premise was wrong rather than the arithmetic. The failure mode was also the
worst available: whitespace that mattered was collapsed, so a real edit was
reported as *no changes*, and the panel then claimed *metadata changed*.

## Decision

RepoDoc does not recognise markdown. Responsibilities split three ways:

| Responsibility | Owner |
| --- | --- |
| Structure — nesting, code, fences, tables, reference definitions | Marked, the reading view's parser, with the same version and options |
| Alignment of old and new blocks | jsdiff, through `diffArrays` with a comparator |
| Which differences are permitted equivalences, and what is rendered | RepoDoc, in `packages/core/src/diff.ts` |

The pipeline parses each complete document once and never reparses a fragment:

```
old document ──▶ Marked tokens ──┐
                                 ├──▶ diffArrays ──▶ annotated rendering
new document ──▶ Marked tokens ──┘
```

Rules that follow from it:

- **Parse whole documents, render original tokens.** Removed content is
  rendered from the old document's tokens and added content from the new.
  Nothing is re-serialised to markdown and parsed again, which is where a
  fragment could acquire a second interpretation.
- **Comparison keys are separate data.** They decide equality; they never stand
  in for content, and one comparison drives both the "has changes" answer and
  the markers shown.
- **The policy reads token types, not source.** Code payloads exactly, prose
  whitespace collapsed, structure as structure, link destinations and titles
  included, unknown or extension tokens compared by raw source.
- **Whole containers are atomic.** A list, table or blockquote is one block, so
  editing one item marks the list. A deliberate granularity trade-off, not a
  hidden miss. Item-level alignment may follow later, over parsed children
  rendered inside their original parent — never by flattening items to strings.
- **Reference definitions are reported explicitly.** They render to nothing, so
  a changed or unused definition is listed as source rather than silently
  dropped.
- **Limits stay.** A library does not make a quadratic alignment cheap. The
  block-count budget and jsdiff's `timeout` both apply, and exceeding either
  means *fine-grained comparison unavailable* — the whole document is reported
  as replaced, never as unchanged.
- **`@repodoc/core/diff` is a separate entry point.** The CLI keeps its
  zero-runtime-dependency promise (`bunx github:flying-dice/repodoc` from a bare
  checkout); only the extension pulls in Marked and jsdiff.

Acceptance is by invariant, not by test count:

- **Preservation** — projecting the comparison onto either side reproduces that
  side's ordinary rendering.
- **Detection** — a changed code payload is never reported as unchanged.
- **Controlled equivalence** — approved prose reflow stays a non-change, while
  hard breaks, code payloads and attributes stay distinguishable.

The oracle is the ordinary parser and its rendered output, never the comparison
key under test, and the cases are generated with `fast-check` over combinations
of nesting, tabs, headings, paragraphs and code.

## Consequences

Easier: markdown RepoDoc renders and markdown RepoDoc compares can no longer
drift apart, because they are the same parse. New syntax — GFM extensions,
footnotes, anything Marked gains — is understood by the diff the day the
reading view understands it. The rules that remain are policy, and policy is
readable in one function.

Harder: the diff is coarser. One edited bullet marks its whole list, and that is
visible to readers who were used to item-level marking. The extension takes two
runtime dependencies it did not have, and the comparison policy must state a
position on every token type — including ones added by a future Marked, which
are compared conservatively by raw source until a rule is written for them.
