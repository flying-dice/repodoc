# RepoDoc

Task boards, decision records, and documentation for VS Code, stored as plain files in your repository.

![RepoDoc boards, cards, decisions, and docs](images/repodoc.gif)

## Everything lives in the repository

A card is a markdown file. A decision is a markdown file. A board is a folder with a JSON config. Project state is versioned with the code it describes, shows up in diffs and pull requests, and travels with every clone. There is no server and no account.

## Rich markdown

Cards, decisions, and docs render full GitHub Flavored Markdown: tables, task lists, strikethrough, and autolinks. Mermaid fences render as diagrams with no network calls. PlantUML fences render through a configurable server, local or remote.

## The board

Columns with drag and drop, WIP limits, labels, priorities, and search. Cards show a checklist count, comment count, progress, and custom field chips. The board updates when the files change on disk.

![Kanban board](images/board.png)

Open a card to edit its fields, tick its checklist, read its description as rendered markdown, and follow its comment history. File references in comments, such as `src/core/store.ts:123`, open that file at that line.

![Card detail](images/card.png)

## Custom fields

Boards define typed fields in their config: text, number, boolean, date, select, and multiselect. Values are stored in each card's frontmatter and edited in the card view. Fields marked `showOnCard` appear as chips on the card.

## Workflow gates

Columns can declare conditions for cards entering or leaving. A script gate requires a recorded green run of a command. A field gate checks a card field against an expression such as `= true`, `>= 3`, or `contains core`. A move that fails a gate is blocked with the reasons listed; choosing to override records the override in the card file.

```json
"enter": [
  { "id": "tests-passing", "script": "npm test", "label": "All tests passing" },
  { "id": "peer-review", "field": "peer-reviewed", "check": "= true", "label": "Peer reviewed" }
]
```

![Card with gates and comment history](images/journal.png)

## Decision records

Numbered markdown records with status and date in frontmatter. The sidebar lists them with status colors, and each record opens in a reading view.

![A rendered decision record](images/decision.png)

## Documentation

The `docs/` tree renders as a handbook. Numeric filename prefixes set the sidebar order. Frontmatter renders as a table under the title. Mermaid fences render as diagrams with no network calls. PlantUML fences render through a configurable server.

![Rendered documentation page](images/docs.png)

## Native to VS Code

Navigation uses standard tree views: boards expand into columns and cards, and decisions and docs open in one click. Every surface follows your color theme.

![The same board in a light theme](images/light.png)

## Getting started

1. Install RepoDoc and open a repository.
2. Click the RepoDoc icon in the activity bar and run **Initialize RepoDoc**. This creates one file, the starter board config.
3. Add cards from the board, or create markdown files under `boards/`.

## File layout

| Path | Contents |
| --- | --- |
| `boards/<board-id>/NN-slug.md` | One card per file. Frontmatter holds column, labels, priority, and field values |
| `boards/<board-id>/.config.json` | Board name, columns, WIP limits, labels, fields, gates |
| `decisions/NN-slug.md` | Decision records with `status:` and `date:` frontmatter |
| `docs/NN-slug.md` | Documentation tree, ordered by numeric prefix |

## Settings

- `repodoc.readingWidth` sets the width of reading views and the card view: narrow, wide, or full.
- `repodoc.plantUmlServer` sets the PlantUML renderer. The default is the public plantuml.com server. To render privately, run `docker run -d --name plantuml -p 8792:8080 plantuml/plantuml-server:jetty` and set the value to `http://localhost:8792`.

## License

[MIT](LICENSE)
