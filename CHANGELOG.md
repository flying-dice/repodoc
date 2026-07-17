# Change Log

## [0.6.1] — 2026-07-17

- Selecting the `docker` PlantUML renderer now enforces a valid configuration: if Docker is unavailable the setting reverts to `server` with a warning, and invalid image/port values fall back to safe defaults.

## [0.6.0] — 2026-07-17

- **PlantUML renderer status indicator** — with the Docker renderer selected, a PlantUML item appears in the status bar showing live state (running / stopped / Docker unavailable, refreshed every 15s). Clicking it opens a management menu: Start, Stop, Restart (reload), and a jump to the PlantUML settings; open reading views re-render after lifecycle actions.

## [0.5.2] — 2026-07-17

- A gear icon at the top of the RepoDoc sidebar opens the extension's settings (filtered to RepoDoc) in one click.

## [0.5.1] — 2026-07-17

- `repodoc.readingWidth` now governs ALL reading surfaces — the card modal follows it too (640px narrow / 900px wide / near-full). The options are renamed **narrow** | **wide** | **full** (a stored legacy `normal` still reads as narrow), and changes apply live to open boards and reading views.

## [0.5.0] — 2026-07-17

- **Bootstrap is config-only** — *Initialize RepoDoc* now creates just the starter board config (`boards/project-backlog/.config.json`); it never seeds cards, decisions, or docs, so initializing an existing repo can't touch your content.
- **No roster, no assignee — but free-text attribution stays** — the `agents` map in board config is gone. The card `agent:` frontmatter key is free text: whoever works a card writes their own name, which renders as a derived avatar (initials + stable hashed colour) on the card and in the live banner. No participant lists anywhere.

## [0.4.2] — 2026-07-17

- Board wheel behavior: inside a column stack the wheel now scrolls strictly vertically (no more surprise horizontal panning when a column's list hits its end); the board background still pans horizontally with a plain wheel.

## [0.4.1] — 2026-07-17

- PlantUML rendering mode is now a single dropdown: `repodoc.plantUmlRenderer` — `server` (default, public plantuml.com via `repodoc.plantUmlServer`) or `docker` (the managed local container). Replaces the `repodoc.plantUmlDocker` boolean.

## [0.4.0] — 2026-07-17

- **Managed local PlantUML renderer** — enable `repodoc.plantUmlDocker` and the extension runs `plantuml/plantuml-server` in a local Docker container (`repodoc-plantuml`) so diagram source never leaves your machine: lazy auto-start when a PlantUML fence renders (views refresh when it's up), `RepoDoc: Start/Stop PlantUML Renderer (Docker)` commands, best-effort stop on deactivate. Image and port are configurable (`repodoc.plantUmlDockerImage`, `repodoc.plantUmlDockerPort`).

## [0.3.9] — 2026-07-17

- **Diagrams in Docs and Decisions** — ```mermaid fences render natively (mermaid is bundled with the extension, theme-aware, no CDN), and ```plantuml / ```puml fences render through a configurable server (`repodoc.plantUmlServer`, defaults to the public plantuml.com; point it at a self-hosted instance for private diagrams or clear it to disable).

## [0.3.8] — 2026-07-17

- The Docs/Decision reading column is wider by default and configurable: `repodoc.readingWidth` — `normal` (760px), `wide` (1100px, default), or `full` (entire editor width). Changing the setting re-renders open views live.

## [0.3.7] — 2026-07-17

- Cards now stand off the column surface in every theme: the card background is derived as an elevation tint above the column colour (with a stronger border), instead of relying on two theme tokens that can resolve to near-identical colours in dark themes.

## [0.3.6] — 2026-07-17

- Card descriptions render as markdown in the card modal (host-rendered with the same pipeline as the docs/decision views): paragraphs, lists, links, inline code, code blocks, and blockquotes, all theme-styled.

## [0.3.5] — 2026-07-17

- Markdown files with YAML frontmatter render it as a tidy key/value meta table in the reading views. Decisions show their full frontmatter (status, date, and any extra keys) as the table under the title; docs pages do the same when they carry frontmatter (which no longer leaks into the rendered body as raw `---` text).

## [0.3.4] — 2026-07-17

- Added the extension icon (kanban columns on the dark panel, in the board's column colours) shown in the Marketplace and the extensions view.

## [0.3.3] — 2026-07-17

- Board overflow is discoverable: a plain mouse wheel now scrolls the board horizontally (column card lists still scroll vertically when they can), and the horizontal scrollbar is always visible.
- Removed the last design-mock leftovers: the header participant chips and the footer "N agents active" counter are gone (the footer keeps the card count and board path), the seeded starter board no longer fakes a live agent, and new boards default to a single `claude` agent entry.
- Boards can be opened directly from the tree via an inline open button on the board row (clicking the row still expands its columns).

## [0.3.2] — 2026-07-17

- Moved to the `flying-dice` organization: repository is now github.com/flying-dice/repodoc and the extension publisher is `flying-dice`.

## [0.3.1] — 2026-07-17

- No person-attribution fields: peer sign-off is an anonymous boolean field (`peer-reviewed`) checked by a field gate — who did what lives in the journal and git history, not in card fields. Skill, docs, and examples updated.

## [0.3.0] — 2026-07-17

- **Workflow gates** — columns declare `enter`/`exit` conditions in the board config: `script` gates (a command that must have run green, evidence recorded in the card's `## Gates` section) and `field` gates (checked live via a mini-syntax: `= v`, `!= v`, `contains v`, `match re`, numeric comparisons, `empty`/`nonempty`). Blocked drags show which gates fail, with a recorded override; agents honor gates via the skill. Approvals are plain field edits (e.g. a `reviewed-by` dropdown) guarded by a field gate.
- **Custom card fields** — boards define typed fields (text, number, boolean, date, select, multiselect) in `.config.json`; values live flat in card frontmatter; the card modal renders native editors (theme-styled dropdowns included) and `showOnCard` fields appear as chips.
- **Comments are a work journal** — the card's `## Comments` section holds authored, timestamped entries; agents journal their work by default per the skill. File references like `src/core/store.ts:123` (or `:12-34`) are one-click links opening the file with the range highlighted.
- Skill files are no longer rewritten silently on activation — a notice with an **Update** button offers the sync instead.
- **Decision frontmatter** — decision records now carry `status:` and `date:` in YAML frontmatter (the rendered view shows them under the title); the legacy body `**Status:**` line is no longer parsed.
- All webview styles use VS Code theme tokens directly — the design-hex `var()` fallbacks are gone (prerelease, no legacy surface to support).

## [0.2.0] — 2026-07-17

- **Theme-native UI** — every webview surface now follows the active VS Code color theme (light, dark, custom) via `--vscode-*` tokens; label/agent/column colors remain user-defined data.
- **Rich boards navigation** — the Boards tree expands each board into its columns and cards; clicking a card opens the board and jumps straight to that card's detail modal.
- **Agent skill manager** — `RepoDoc: Install Agent Skill` writes a managed `repodoc-workflow` skill file for Claude Code (`.claude/skills/`) or OpenCode (`.opencode/skill/`) teaching agents the full workflow; the extension re-syncs installed files to the latest version on activation.
- Card detail modal simplified to the essentials — priority, live agent status, description, and checklist. The Assignee block and the "files touched" list are gone (the `files` frontmatter field is no longer read), and checklist checkboxes got a styling/alignment pass.
- This repository now dogfoods RepoDoc: its own board, decision records, and docs handbook live in `boards/`, `decisions/`, and `docs/`.

## [0.1.0] — 2026-07-17

Initial release.

- **Native navigation** — RepoDoc activity-bar container with Boards, Decisions, and Docs tree views.
- **Kanban board view** — drag & drop between columns with WIP limits, labels, priorities, card search, per-agent filters, live agent status/progress on cards, add card/list inline.
- **Card detail view** — assignee, priority, description, toggleable checklist, and touched files (click to open in the editor).
- **Decision records** — numbered markdown ADRs with status lifecycle, rendered in a reading view.
- **Docs** — Docusaurus-style tree from `docs/`, ordered by numeric prefixes, rendered in a reading view.
- **Files-in-repo storage** — one markdown file per card (`boards/<id>/NN-slug.md` + `.config.json`), `decisions/NN-slug.md`, `docs/NN-slug.md`; live-updates via file watchers so external (agent) edits appear immediately.
- **Ports & Adapters core** — vscode-free store behind filesystem/clock ports; Node adapter in production, in-memory adapter in tests.
- **Testing** — 116 unit tests on a virtual filesystem plus 8 end-to-end tests driving the real extension.
