# Overview

RepoDoc is a VS Code extension that turns your repository into the place you run
your project from. It gives VS Code a kanban board, decision records, and a
documentation site — all stored as plain markdown and JSON in the repo, right
next to the code they describe.

The point is that your coding agents already live in the repo. Because a card is
a markdown file, a decision is a markdown file, and the board is a folder,
anything that can edit files — Claude Code, Cursor, Copilot, or you in an editor
— can pick up tickets, report progress, record decisions, and keep the docs
current. There is no server, no account, and no sync.

## This repo dogfoods itself

The content you are reading lives in the RepoDoc repository and is rendered by
RepoDoc itself. The board under `boards/repodoc/` tracks the actual work that
built the extension, the records under `decisions/` are the real architecture
decisions taken along the way, and this handbook under `docs/` is the
contributor documentation. It is all true to the project's history — and it all
parses through the exact same core the shipped extension uses.

## Where everything lives

| Path | Contents |
| --- | --- |
| `boards/<board-id>/NN-slug.md` | One card per file — frontmatter holds column, labels, priority, live status |
| `boards/<board-id>/.config.json` | Board name, columns, WIP limits, labels |
| `decisions/NN-slug.md` | Decision records with frontmatter `status:`/`date:` |
| `docs/NN-folder/NN-slug.md` | Documentation tree — numeric prefixes order the sidebar |

## Where to go next

- [Development](02-development.md) — set up, run, and test the extension.
- [Architecture](03-architecture.md) — how the code is organised.
- [Working the board](../02-guides/01-working-the-board.md) — day-to-day flow.
- [File formats](../03-reference/01-file-formats.md) — the exact on-disk schema.
