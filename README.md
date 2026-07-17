# RepoDoc — run your project from inside the repo

**Be the PM and tech lead of your codebase while coding agents do the work.** RepoDoc gives VS Code a kanban board, decision records, and a documentation site — all stored as plain markdown and JSON in your repository, so the agents working in your repo can pick up tickets, report live progress, record decisions, and keep the docs current. You review, prioritize, and steer.

![RepoDoc — boards, cards, decisions, and docs](images/repodoc.gif)

## Why files in the repo?

Because that's where your agents already are. There's no server, no account, no sync — a card is a markdown file, a decision is a markdown file, the board is a folder. Anything that can edit files (Claude Code, Cursor, Copilot, or you with `vim`) can move work forward, and every change is versioned with the code it describes.

- **Diffable & reviewable** — planning changes show up in pull requests.
- **Agent-native** — moving work forward is just editing a file your agent already sees.
- **Portable** — clone the repo, get the whole project brain.

## Native to your editor

RepoDoc looks and feels like part of VS Code, not an app in a webview. Navigation is native tree views — every board expands to its columns and cards, so any card is one click away — and every surface follows your color theme, light, dark, or custom:

![The same board in a light theme](images/light.png)

## The board

Trello-style columns with drag & drop, WIP limits, labels, priorities, and search. A card being actively worked shows a **live status line and progress bar**.

![Kanban board with live agent progress](images/board.png)

Click a card for the full picture — priority, live agent status, description, and checklist:

![Card detail with checklist](images/card.png)

## Workflows with gates

Columns can declare **enter/exit gates** — conditions a card must satisfy to move. A gate is one of two kinds: a **script** gate requires a command to have run green (the agent records the evidence in the card's `## Gates` section), or a **field** gate checks a card field live via a small `check` syntax (`= v`, `>= n`, `contains v`, `match <re>`, …). Approvals are just field gates — a reviewer sets a field the gate checks.

```json
"enter": [
  { "id": "tests-passing", "script": "npm test", "label": "All tests passing" },
  { "id": "peer-review", "field": "peer-reviewed", "check": "= true", "label": "Peer reviewed" }
]
```

On this board a card can't enter **In Review** until `npm test` passes, and can't reach **Done** until the `peer-reviewed` field is checked. The process lives in config, so it shows up in diffs and is honored by the agents editing the files. Gate status, custom fields, and the agent's **work journal** — with one-click `path:line` links into the code — all live on the card:

![Card with gates, fields, and the agent journal](images/journal.png)

## Decision records

Capture the *why* behind architectural choices as numbered markdown records with a status lifecycle (Proposed → Accepted → Superseded). Agents read them before touching related code.

![A rendered decision record](images/decision.png)

## Docs

A Docusaurus-style handbook rendered from your `docs/` tree. Add a folder, drop in a `.md` file, and it shows up in the sidebar — numeric prefixes control the order. Pages render YAML frontmatter as a meta table, ```mermaid fences as native diagrams, and ```plantuml fences via a configurable renderer — `repodoc.plantUmlRenderer` chooses between a server URL (default: the public plantuml.com via `repodoc.plantUmlServer`) and a **local Docker container the extension manages for you**, so diagram source never leaves your machine.

![Rendered documentation page](images/docs.png)

## Getting started

1. Install RepoDoc and open your repository.
2. Click the RepoDoc icon in the activity bar and hit **Initialize RepoDoc** — it creates a starter board config. Your cards, decisions, and docs are yours to add.
3. Open the board, add cards, and point your coding agent at the repo.

Everything lives in four places:

| Path | Contents |
| --- | --- |
| `boards/<board-id>/NN-slug.md` | One card per file — frontmatter holds column, labels, priority, live status |
| `boards/<board-id>/.config.json` | Board name, columns (with WIP limits and gates), labels, custom fields |
| `decisions/NN-slug.md` | Decision records — frontmatter `status:` and `date:` |
| `docs/NN-slug.md` | Documentation tree (numeric prefix orders the sidebar) |

## Working with agents

Tell your agent the conventions once (or drop them in your agent instructions file):

- Pick up a card by setting `column: doing` in its frontmatter and noting who you are in its `## Comments` journal — there is no assignee field.
- Report progress with `live: true`, `status: <one-liner>`, `progress: 0-100`.
- Tick checklist items (`- [x]`) as you complete them.
- Set any **custom fields** the board defines (e.g. `release: v0.2.0`, `estimate: 5`) as flat frontmatter keys.
- Journal your work in the card's `## Comments` section — one entry per meaningful step (`- **<you>** (<ISO>): <what and why>`), citing the code you touched as `path:line` (e.g. `src/core/store.ts:123`). RepoDoc turns those into one-click links that open the file at that range.
- Made a significant choice? Add the next `decisions/NN-*.md` and link it from the card.

RepoDoc watches the files and updates the board live.

### Teach your agent (skill files)

Run **RepoDoc: Install Agent Skill** from the command palette to drop a `repodoc-workflow` skill into `.claude/skills/` (Claude Code) or `.opencode/skill/` (OpenCode). It teaches the agent the whole workflow above — claiming cards, reporting live progress, recording decisions, and keeping docs current. Installed skill files are managed: when RepoDoc ships a newer version, the extension shows a notice with an **Update** button — nothing is rewritten without your say-so (updating replaces any local edits).

## Development

`npm install`, then `F5` for an Extension Development Host. `npm run compile` type-checks, lints, and bundles; `npm test` runs the unit suite (on an in-memory filesystem) and the e2e suite (driving the real extension). Releases are cut by tagging `v*` — CI packages the VSIX and attaches it to the GitHub release.

## License

[MIT](LICENSE)
