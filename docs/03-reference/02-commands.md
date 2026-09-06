# Commands

These are the VS Code extension's commands. For the terminal equivalents see
[the CLI reference](03-cli.md).

RepoDoc contributes a `repodoc` activity-bar container with three tree views —
Boards, Decisions, and Docs — and the commands below (declared under the
`RepoDoc` category in `package.json`).

| Command | ID | What it does |
| --- | --- | --- |
| Initialize Workspace | `repodoc.init` | Writes the starter board config (never touches existing content) |
| Refresh | `repodoc.refresh` | Re-reads the data from disk and refreshes the views |
| Open Board | `repodoc.openBoard` | Opens a board in the kanban webview panel |
| Open Decision | `repodoc.openDecision` | Opens a decision record in the reading view |
| Open Doc | `repodoc.openDoc` | Opens a docs page in the reading view |
| New Board | `repodoc.newBoard` | Creates a new board folder and `.config.json` |
| New Decision | `repodoc.newDecision` | Creates the next `decisions/NN-*.md` skeleton |

The `openBoard`, `openDecision`, and `openDoc` commands are wired to tree
selections and hidden from the command palette; the rest are available from the
palette or the view title-bar icons.

## Live updates

RepoDoc watches the files under `boards/`, `decisions/`, and `docs/`. When those
files change on disk — whether you edit them, or a coding agent does — the store
is notified and the board and views update without a manual refresh.
