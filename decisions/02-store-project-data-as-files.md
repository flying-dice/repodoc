---
status: Accepted
date: 2026-07-15
---
# Decision 02 — Store all project data as plain files in the repository


## Context

RepoDoc is a tool for running a project from inside its own repository, where
coding agents already live. A conventional kanban or docs tool keeps its data in
a database behind a server and an account. That data would be invisible to the
agents editing the repo, decoupled from the code it describes, and impossible to
review in a pull request.

## Decision

All RepoDoc data is stored as plain files in the repository:

- A board is a folder, `boards/<board-id>/`, with a `.config.json` and one
  markdown file per card.
- Decision records are markdown files under `decisions/`.
- Docs are a markdown tree under `docs/`.

There is no server, no database, and no account. Anything that can edit files —
Claude Code, Cursor, Copilot, or a human with an editor — can move work forward,
and every change is versioned with the code it describes.

## Consequences

- Planning changes show up in diffs and pull requests, reviewable like code.
- Assigning a ticket to an agent is just telling it to edit a file.
- Cloning the repo brings the entire project brain with it — fully portable.
- Concurrent edits can produce merge conflicts, resolved with the same git tools
  as any other file.
- There is no central source of truth beyond the repo, and no cross-repo
  aggregation or server-side query.
