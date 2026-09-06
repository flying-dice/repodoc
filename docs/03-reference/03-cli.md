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
| `--root <dir>` | Workspace root. Default: the nearest ancestor of the current directory containing `boards/`, `decisions/`, `docs/`, or `features/`; else the nearest git root; else the current directory. `REPODOC_ROOT` also works. A root that is a file, or a path that does not exist, is a usage error (exit `2`) — only `init` may name a directory that does not exist yet, which it creates. |
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
| `board show <board>` | Columns (with WIP and gate ids) and the cards in each. A board whose `.config.json` is missing or malformed shows the default columns and a one-line warning on stderr, leaving stdout (and `--json`) clean. |
| `board create <name>` | New board with default columns and labels. |
| `column add <board> <name>` | Append a column. |
| `card list <board> [--column <id>]` | Cards in board order. |
| `card show <board> <card>` | Metadata, description, checklist (indexed), gates, comments. |
| `card create <board> <title> [--column <id>] [--priority p] [--labels a,b] [--agent name]` | New card; first column unless `--column`. Prints the new card id (its slug). |
| `card move <board> <card> <column> [--index n] [--override --reason <why>]` | Move to the bottom of a column (or `--index`). Refuses when gates fail and prints each failing gate's `prompt`; on success prints the target column's `prompt`. `--override` needs a `--reason`, recorded per overridden gate as the board does. |
| `card gates <board> <card> <column>` | Evaluate the exit/enter gates for that move, with each failing gate's prompt. Exit `1` while any fails. |
| `card gate-pass <board> <card> <gate> <result>` | Record `- [x] <gate> — <result> (<who>, <time>)` under `## Gates`. Only after a real green run. |
| `card comment <board> <card> <text>` | Append a journal entry to `## Comments`. |
| `card update <board> <card> [--title] [--agent] [--live] [--status] [--progress] [--priority] [--labels]` | Set reserved metadata. Pass `""` to remove a key. |
| `card check <board> <card> <index>` | Toggle a checklist item (0-based, as shown by `card show`). |
| `card check-add <board> <card> <text>` | Append a new `## Checklist` item (creating the section if absent). Prints the new item's index. |
| `card describe <board> <card> <text>` | Set the card's description (the body between the title and its first `##` section). Pass `""` to clear it. |
| `card set <board> <card> <field> [value] [--clear]` | Set a board-defined custom field; values are typed per the field def, multiselects comma-separated. |
| `feature sets` | Feature sets with feature counts. |
| `feature set-create <name>` | New feature set with the default specification columns (`proposed`, `specified`, `implemented`, `verified`). |
| `feature list <set> [--column <id>]` | Features in column order. |
| `feature show <set> <feature>` | Title, status, tags, description and scenarios. |
| `feature create <set> <title> [--column <id>]` | New `<slug>.feature` holding a `@status:` tag and a `Feature:` line; first column unless `--column`. |
| `feature move <set> <feature> <column>` | Rewrite the feature's `@status:` tag — the file is never renamed — and print the target column's `prompt`. Gates are not enforced for features. |
| `decision list` / `decision show <id>` / `decision create <title>` | Decision records. |
| `decision status <id> <Proposed\|Accepted\|Superseded>` | Set a decision's status. |
| `docs tree` / `docs show <relPath>` | The documentation tree. |
| `skill install [claude\|opencode]` | Write the RepoDoc agent skill file into the repo. |

## Gates feed the agent the workflow

A board's `.config.json` may give each gate and each column a `prompt`. A
refused move looks like this, and is the mechanism by which an agent is told
what process to follow before it may proceed:

```
repodoc: refusing to move add-csv-export → review. 2 gates must be satisfied first:

1. All tests passing (tests-passing) — no recorded green run of `bun run test`
   Run `bun run check-types && bun run lint && bun run test` from the repo root.
   Only when every command exits 0, record the summary with gate-pass.

2. change-review skill run (change-review) — no recorded green run of `claude /change-review`
   Stage the change and run the `change-review` skill over the staged diff. Fix
   every bug/issue finding, re-run until clean, then record the result with gate-pass.

Do the work above, then re-run this move. Record a green script run with
`repodoc card gate-pass <board> add-csv-export <gate> "<result>"`; set a field with `repodoc card set`.
Only a human may authorise `--override --reason <why>`.
```

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
