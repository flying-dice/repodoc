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
| Open Card File | `repodoc.openCardFile` | Opens the card's `boards/<id>/NN-slug.md` in an editor |
| Open Board Config | `repodoc.openBoardConfig` | Opens a board's or feature set's `.config.json` |
| Open Source | `repodoc.openDecisionSource` | Opens a decision's markdown file in an editor |
| Open Source | `repodoc.openDocSource` | Opens a docs page's markdown file in an editor |
| Set Status… | `repodoc.setDecisionStatus` | Sets a decision's frontmatter `status:` (Proposed / Accepted / Superseded) |

Every command that takes a tree item as its argument — `openBoard`,
`openDecision`, `openDoc`, `openCardFile`, `openBoardConfig`,
`openDecisionSource`, `openDocSource`, `setDecisionStatus` — is wired to a tree
selection and hidden from the command palette; the rest are available from the
palette or the view title-bar icons.

## Menus

Because the UI cannot yet do everything the file format allows, every RepoDoc
surface offers a route to the underlying file.

| Where | Items |
| --- | --- |
| Boards tree, a board or feature set | Open Board (inline), Open Board Config |
| Boards tree, a card | Open Card File (inline and in the context menu) |
| Decisions tree, a decision | Open Source (inline), Set Status… |
| Docs tree, a page | Open Source (inline) |
| Board panel status bar | The data-directory path opens `.config.json` |
| Card view header | **Open file** opens the card's markdown (a feature's `.feature`) |
| Decision / Doc reading view | **Open source** in the top bar, and the file path under the title |

## Live updates

RepoDoc watches the files under `boards/`, `decisions/`, and `docs/`. When those
files change on disk — whether you edit them, or a coding agent does — the store
is notified and the board and views update without a manual refresh.
