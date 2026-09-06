# CLI

The `repodoc` command drives the same store as the extension. Run it with Bun
from anywhere inside a repository:

```sh
bunx github:flying-dice/repodoc <command> [args] [--root <dir>] [--who <name>] [--json]
```

There is no install step and nothing to build: Bun fetches the repository and
runs the TypeScript entry point directly. Inside this checkout use
`bun run repodoc -- <command>`.

## Global flags

| Flag | Meaning |
| --- | --- |
| `--root <dir>` | Workspace root. Default: the nearest ancestor of the current directory containing `boards/`, `decisions/`, or `docs/`; else the nearest git root; else the current directory. `REPODOC_ROOT` also works. |
| `--who <name>` | Author for comments, gate evidence, and overrides. Default: `REPODOC_AUTHOR`, then `git config user.name`, then the OS user. |
| `--json` | Print the result as JSON instead of text. |
| `--help` | Show usage. `repodoc help card` lists one group. |

Exit codes: `0` success, `1` the store refused (unknown card, failing gates,
duplicate slugs…), `2` usage error, `3` unexpected failure.

## Commands

| Command | What it does |
| --- | --- |
| `init` | Writes the starter `boards/project-backlog/.config.json` if absent. Never touches existing content. |
| `board list` | Boards with card counts. |
| `board show <board>` | Columns (with WIP and gate ids) and the cards in each. |
| `board create <name>` | New board with default columns and labels. |
| `column add <board> <name>` | Append a column. |
| `card list <board> [--column <id>]` | Cards in board order. |
| `card show <board> <card>` | Metadata, description, checklist (indexed), gates, comments. |
| `card create <board> <title> [--column <id>] [--priority p] [--labels a,b] [--agent name]` | New card; first column unless `--column`. Prints the new card id (its slug). |
| `card move <board> <card> <column> [--index n] [--override]` | Move to the bottom of a column (or `--index`). Refuses when gates fail; `--override` records an override per failing gate, as the board does. |
| `card gates <board> <card> <column>` | Evaluate the exit/enter gates for that move. Exit `1` while any fails. |
| `card gate-pass <board> <card> <gate> <result>` | Record `- [x] <gate> — <result> (<who>, <time>)` under `## Gates`. Only after a real green run. |
| `card comment <board> <card> <text>` | Append a journal entry to `## Comments`. |
| `card update <board> <card> [--title] [--agent] [--live] [--status] [--progress] [--priority] [--labels]` | Set reserved metadata. Pass `""` to remove a key. |
| `card check <board> <card> <index>` | Toggle a checklist item (0-based, as shown by `card show`). |
| `card set <board> <card> <field> [value] [--clear]` | Set a board-defined custom field; values are typed per the field def, multiselects comma-separated. |
| `decision list` / `decision show <id>` / `decision create <title>` | Decision records. |
| `docs tree` / `docs show <relPath>` | The documentation tree. |
| `skill install [claude\|opencode]` | Write the RepoDoc agent skill file into the repo. |

## An agent's session

```sh
R="bunx github:flying-dice/repodoc"
$R card show project-backlog add-csv-export --json
$R card update project-backlog add-csv-export --agent claude --live true --status "Wiring the endpoint" --progress 20
$R card move project-backlog add-csv-export doing
$R card comment project-backlog add-csv-export "Endpoint in src/export/router.ts:22-49; tests next" --who claude
$R card check project-backlog add-csv-export 1
bun test && $R card gate-pass project-backlog add-csv-export tests-passing "bun test green" --who claude
$R card gates project-backlog add-csv-export review && $R card move project-backlog add-csv-export review
$R card update project-backlog add-csv-export --live false --progress 100
```
