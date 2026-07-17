/**
 * First-run seed content: a starter board, a starter decision record, and an
 * introduction doc. Pure data builders — the store writes them through the
 * FileSystemPort on `init`.
 */

import { BoardConfig, DEFAULT_AGENTS, DEFAULT_LABELS, defaultColumns } from './boardConfig';

export function seedBoardConfig(): BoardConfig {
  return {
    name: 'Project Backlog',
    columns: defaultColumns(),
    labels: { ...DEFAULT_LABELS },
    agents: { ...DEFAULT_AGENTS },
    fields: [],
  };
}

export function seedCards(stamp: string): Array<{ name: string; content: string }> {
  return [
    {
      name: '01-try-dragging-this-card.md',
      content:
        `---\ncolumn: backlog\nlabels: [docs]\npriority: low\nupdatedAt: ${stamp}\n---\n` +
        `# Try dragging this card to another column\n\n` +
        `Cards live as markdown files under \`boards/project-backlog/\`. Drag one across ` +
        `columns and watch its file get renumbered on disk.\n`,
    },
    {
      name: '02-add-a-card-or-let-an-agent.md',
      content:
        `---\ncolumn: backlog\nlabels: [frontend]\npriority: med\nupdatedAt: ${stamp}\n---\n` +
        `# Add a card with the + button, or let an agent add one\n\n` +
        `Every card is plain markdown with a little frontmatter. Humans and coding agents ` +
        `edit the same board.\n`,
    },
    {
      name: '03-write-your-first-decision.md',
      content:
        `---\ncolumn: todo\nlabels: [docs]\npriority: med\nupdatedAt: ${stamp}\n---\n` +
        `# Write your first decision record\n\n` +
        `Decision records capture the *why* behind architectural choices, numbered under ` +
        `\`decisions/\`.\n\n` +
        `## Checklist\n\n` +
        `- [x] Open the Decisions view\n` +
        `- [ ] Create the next decision\n` +
        `- [ ] Fill in Context and Decision\n`,
    },
    {
      name: '04-assign-a-card-to-an-agent.md',
      content:
        `---\ncolumn: doing\nlabels: [backend, infra]\npriority: high\nagent: claude\n` +
        `files: [src/core/store.ts]\nupdatedAt: ${stamp}\n---\n` +
        `# Assign a card to a coding agent\n\n` +
        `Agents pick up assigned cards, report live status, and list the files they touch.\n\n` +
        `## Checklist\n\n` +
        `- [x] Assign the card\n` +
        `- [x] Agent starts working\n` +
        `- [ ] Review the result\n\n` +
        `## Comments\n\n` +
        `- **claude** (${stamp}): Picked up the card and started editing \`src/core/store.ts\`.\n`,
    },
    {
      name: '05-review-before-done.md',
      content:
        `---\ncolumn: review\nlabels: [perf]\npriority: med\nupdatedAt: ${stamp}\n---\n` +
        `# Review changes before moving a card to Done\n\n` +
        `Cards flow left to right. Keep a review step so work is checked before it lands.\n`,
    },
    {
      name: '06-initialize-repodoc.md',
      content:
        `---\ncolumn: done\nlabels: [infra]\npriority: low\nupdatedAt: ${stamp}\n---\n` +
        `# Initialize RepoDoc in your repo\n\n` +
        `Done — this board, a starter decision, and a docs page were seeded for you.\n\n` +
        `## Checklist\n\n` +
        `- [x] Create the boards/ folder\n`,
    },
  ];
}

export function seedDecision(date: string): string {
  return (
    `---\nstatus: Accepted\ndate: ${date}\n---\n` +
    `# Decision 01 — Record architecture decisions\n\n` +
    `## Context\n\n` +
    `We make architecturally significant decisions on this project regularly, but the ` +
    `reasoning tends to live in scattered chat threads and pull-request comments. New ` +
    `contributors — human and agent alike — have no single place to understand *why* the ` +
    `system is shaped the way it is.\n\n` +
    `## Decision\n\n` +
    `We will keep a collection of **Architecture Decision Records**. An ADR is a short ` +
    `markdown file describing one decision, its context, and its consequences.\n\n` +
    `- Records live in \`decisions/\` and are numbered sequentially.\n` +
    `- Each record is immutable once **Accepted** — we supersede rather than edit.\n` +
    `- Agents are instructed to read relevant decisions before starting related work.\n\n` +
    `## Consequences\n\n` +
    `- The reasoning behind decisions becomes durable and searchable.\n` +
    `- There is a small ongoing cost to writing a record for each significant decision.\n` +
    `- Superseded records stay in history, giving a timeline of how thinking evolved.\n`
  );
}

export function seedIntroDoc(): string {
  return (
    `# Introduction\n\n` +
    `Welcome to your project's documentation. This tree is rendered from the markdown ` +
    `files living under \`docs/\`.\n\n` +
    `> Add a folder, drop in a \`NN-slug.md\` file, and it shows up in the sidebar.\n\n` +
    `## How it works\n\n` +
    `- Folders become collapsible sections in the Docs view.\n` +
    `- A leading \`NN-\` number orders pages; the label drops the number.\n` +
    `- Each \`.md\` file is a page; its first \`# heading\` becomes the label.\n\n` +
    `Edit this file or add your own to make the docs your own.\n`
  );
}
