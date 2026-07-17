/**
 * The canonical RepoDoc agent skill. This is the single source of truth for the
 * skill document that gets written into a repo (under `.claude/skills/` or
 * `.opencode/skill/`) so coding agents learn the RepoDoc workflow. The
 * SkillManager writes {@link SKILL_MD} verbatim and rewrites installed copies
 * whenever this content changes, keeping every repo in sync as RepoDoc evolves.
 */

/** Skill identifier — also the directory name under each agent's skills folder. */
export const SKILL_NAME = 'repodoc-workflow';

/** The full skill document (YAML frontmatter + agent-facing guide). */
export const SKILL_MD = `---
name: ${SKILL_NAME}
description: How to work a RepoDoc project — pick up cards from the kanban board, report live progress, record decisions, and keep docs current. Use whenever this repo contains boards/, decisions/, or docs/ managed by RepoDoc.
---

# Working a RepoDoc project

RepoDoc keeps a project's kanban board, decision records, and documentation as
plain files in the repo. You move work forward by editing those files. A VS Code
extension watches them and updates its UI live — you never reload anything.

## Layout

- \`boards/<board-id>/NN-slug.md\` — one card per file. The \`NN\` prefix is the
  card's global position on the board.
- \`boards/<board-id>/.config.json\` — board \`name\`, \`columns\`, WIP limits,
  \`labels\`, and \`agents\` (the keys you may assign yourself to).
- \`decisions/NN-slug.md\` — decision records, ordered by prefix.
- \`docs/NN-slug.md\` (and subfolders) — the documentation tree; the numeric
  prefix orders the sidebar.

## Card file anatomy

Frontmatter keys (all optional except \`column\`):

- \`column\` — the column id the card sits in (e.g. \`backlog\`, \`todo\`, \`doing\`,
  \`review\`, \`done\`).
- \`labels\` — a list, e.g. \`[bug, backend]\`.
- \`priority\` — \`high\` | \`med\` | \`low\`.
- \`agent\` — the agent key working the card (from \`.config.json\` \`agents\`).
- \`live\` — \`true\` while you are actively working, else \`false\`/absent.
- \`status\` — a one-line human summary of what you are doing right now.
- \`progress\` — an integer 0-100.
- \`comments\` — a NUMBER (the comment-count badge), not freeform text.
  Note: list values (\`labels\`) must use the INLINE form \`[a, b]\` — block-style
  YAML lists (\`- item\` on their own lines) are NOT parsed.
- \`updatedAt\` — ISO timestamp; bump it on every edit.

Body: a \`# Title\` heading, a short description, then a \`## Checklist\` of
\`- [ ]\` task items.

Example card (\`boards/project-backlog/03-add-csv-export.md\`):

\`\`\`markdown
---
column: doing
labels: [feature, backend]
priority: high
agent: claude
live: true
status: Wiring the export endpoint
progress: 40
updatedAt: 2026-07-17T10:32:00.000Z
---
# Add CSV export

Let users download their report data as CSV. See decisions/04-export-format.md.

## Checklist

- [x] Design the CSV column mapping
- [ ] Implement the export endpoint
- [ ] Add tests
\`\`\`

## Working a card

1. Claim it: set \`agent: <your-key>\` and \`column: doing\`.
2. While working: set \`live: true\`, a one-line \`status\`, and \`progress\`.
3. Tick checklist items \`- [x]\` as you finish them.
4. When done: set \`column: review\` (a human moves it to \`done\`), set
   \`live: false\`, and remove \`status\`/\`progress\`.
5. Always bump \`updatedAt\` on every change.

## Ordering

The \`NN\` prefix is the card's global order across the whole board. The extension
renumbers cards for you when a human drags them — never renumber other cards
yourself. To add a card, use the next free \`NN\` and a fresh slug.

## Decisions

When a significant choice is made, record it. Add \`decisions/<next-NN>-slug.md\`:

\`\`\`markdown
# Decision NN — Title

**Status:** Proposed

## Context

Why this came up.

## Decision

What was chosen.

## Consequences

What this implies, and any trade-offs.
\`\`\`

Link the decision from the card's description so reviewers can find it.

## Docs

Keep \`docs/\` current whenever behavior changes. The first \`# \` heading in a doc
file is its sidebar label; the numeric prefix orders it.

## Remember

The extension watches all of these files — just save your edits, no reload
needed. Bump \`updatedAt\`, keep \`status\`/\`progress\` honest while \`live\`, and
leave the board reflecting reality.
`;
