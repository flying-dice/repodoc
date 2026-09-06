# Change Log

## [0.9.0] — 2026-09-06

- **Ids never collide.** `board create`, `feature set-create`, `card create` and `feature create` allocate a unique id case-insensitively (`team`, then `team-2`), so creating a board or feature set that already exists no longer overwrites its config, and `Login.feature` is safe from `login.feature` on macOS and Windows.
- **Gates carry the workflow.** A gate or column may declare a `prompt`; `repodoc card move` refuses with each failing gate's instructions and prints the target column's on success, `--override` requires `--reason`, and the board's blocked-move dialog shows the same guidance with inline gate recording and a required reason.
- **Stricter refusals.** The comment author (`--who`) is flattened to one line, so a name can no longer forge a `## Gates` section with satisfied gates in it; `card gate-pass` refuses a gate no column of the board declares (and any id carrying whitespace or ` — `), naming the gates that exist; `--override` without a non-empty `--reason` is a usage error whether or not a gate blocks the move; and a blank value for a number field or a blank `card check` index is a usage error instead of writing `0` / toggling the first item.
- **Hardening.** Frontmatter round-trips block-style YAML and comments verbatim; newlines cannot be injected into frontmatter from any host; CRLF files stay CRLF; duplicate card slugs no longer duplicate cards or break the tree; one `moveCardGated` policy serves both hosts. Toolchain: Bun, TypeScript 7 under the strictest flag set, Biome.
- **Card ids and copy ref.** Every card face and the card view show the card id, and a "Copy ref" button (also on tree nodes) copies `<board>/<id> — <title> (<path>)` — the exact form every `repodoc card …` command takes, ready to paste into an agent chat. `card show` and `feature show` print the same `ref:` line.
- **A CLI over the same core.** `bunx github:flying-dice/repodoc <command>` runs `repodoc` straight from the repository with no install or build step: `board list|show|create`, `column add`, `card list|show|create|move|gates|gate-pass|comment|update|check|set`, `decision list|show|create`, `docs tree|show`, `skill install`, and `init`. Every command takes `--json`, `--root`, and `--who`. `card move` enforces workflow gates exactly like the board and records overrides only with `--override`.
- **Bun workspace.** The repository is now three packages — `@repodoc/core` (the vscode-free store and adapters), `@repodoc/cli`, and the `repodoc` extension — installed, scripted, and unit-tested with Bun. Core and CLI unit tests run under `bun test`; the extension's end-to-end suite still runs on `@vscode/test-cli`. See `decisions/09-one-core-two-hosts.md`.
- **Core API.** `moveCard` and `addCard` return a result instead of failing silently; new `updateCardMeta` (title, labels, priority, agent, live, status, progress) and `recordGateEvidence`.
- **Fix.** The free-text `agent:` frontmatter key is parsed onto cards again, so the avatar and the live banner render for agent-claimed cards.
- **No silent overwrites.** Description and title saves refuse to overwrite a value changed on disk while the editor was open: nothing is written and the editor offers Reload / Keep mine, the same choice a scenario block already gives.
- **Managed feature editing.** A feature's title, description and scenarios are editable from the card view and the CLI, without opening the raw file: click-to-edit the title, write the prose under `Feature:`, and add, rewrite or remove scenarios (name plus steps, one per line). Every edit rewrites only the construct it names — feature and scenario tags, `Rule:` and `Background:` blocks, doc strings, `Examples:` tables, comments, indentation and CRLF endings all survive byte for byte, and a scenario's body is carried verbatim rather than interpreted, so nothing RepoDoc does not model is ever discarded. Unsaved text survives a background refresh, an edit that arrives from the file while yours is open says so and offers *Reload* / *Keep mine* instead of overwriting either side, and **Open file** remains the escape hatch for tags and everything else. New CLI: `feature rename|describe|scenario-add|scenario-set|scenario-remove`, and `feature show` now prints each scenario's index and steps.
- **Feature sets.** `features/<set-id>/` folders of Gherkin `.feature` files render on the same kanban surface as a board, with columns from a `features/<set-id>/.config.json` in the board-config shape. A feature's column is a `@status:<columnId>` tag on its Feature tag line; moving one rewrites only that tag and never renames the file. New CLI group `feature sets|set-create|list|show|create|move`, feature sets in the Boards tree, and gates are not enforced for features in this iteration.
- **Skill.** The agent skill teaches the CLI first and hand-editing as the fallback.
- **A feature opens where it is managed.** Clicking (or keyboard-activating) a feature in the Boards tree now opens its feature set's board panel and that feature's detail view — reusing the panel if it is already open — instead of dropping you into the raw Gherkin. The `.feature` file is still one click away: *Open Feature File* is an inline and context-menu action on every feature node, and **Open file** in the detail view is unchanged.
- **A route to the file from every surface.** The card view header has **Open file**; the board's status-bar path opens the board `.config.json`; the Boards tree gains *Open Card File* and *Open Board Config*; the Decision and Docs reading views gain an **Open source** action (and a clickable file path), mirrored as inline actions on the Decisions and Docs trees. When the UI cannot do something, the file is one click away.
- **Card metadata is editable in the card view.** Click-to-edit title, a Priority select (None / Low / Medium / High), Labels as toggle chips in the board's own label colours, and an always-present Activity row — agent, a live toggle, and (while live) status and progress. Clearing a value removes the key, matching the CLI's `--flag ""` convention. Feature cards keep their title and tags in the `.feature` file.
- **Gates read as guidance, not as a "no".** A refused move now opens a guided checklist — *Before &lt;card&gt; can move to &lt;Column&gt;* — listing each failing gate with its label, id, reason and the gate's `prompt` (or the same default wording the CLI prints), plus the action that satisfies it: script gates show the command with **Copy** and an inline *Record a green run…* input; field gates embed the field editor. The dialog stays open across refreshes so gates can be ticked one after another, and **Move** becomes available once they all pass. The card view's Gates section shows the same guidance before the drag — this column's exit gates and the next column's enter gates, each with a *How to satisfy* disclosure, *Show all transitions* for the rest, and a **Move to &lt;next column&gt;** button for keyboard users. A column's `prompt` appears in the card view as a dismissible *In this column* panel.
- **Overrides record a reason.** *Override…* now requires a reason before *Override & move*, and the recorded identity is the configured comment author — so a human's override line reads exactly like an agent's `--override --reason`.
- **Checklist and description authoring.** Add checklist items from the card view, and write or edit the description in place (Cmd/Ctrl+Enter saves, Escape cancels); both round-trip through the store to the card file.
- **Decision status from the tree.** *Set Status…* writes `status:` in a decision's frontmatter.
- **Fixes.** An unset priority reads *None* instead of *Medium*; column counts and WIP state are computed over all cards, showing "n of N" only while a search filter is active; a live card with no `progress` no longer claims "0% complete"; the card view's gate list no longer offers requirements for columns behind the card; and Escape closes the blocked-move dialog and then the card view, which now carry `role="dialog"`, `aria-modal`, labelled close buttons and focus on open.

- **Reading-view fixes from the UX review.** An unsent comment draft now belongs to the card it was typed on — keyed by board and card, kept if you close and reopen that card, and never carried into the next one. Relative markdown links in Decisions and Docs navigate: a link to a `decisions/*.md` opens that record, one under `docs/` opens that page, any other in-repo file opens in an editor, `#anchors` scroll the page, `http(s)` links open in your browser, and anything resolving outside the workspace is refused. Checklist items and boolean custom fields are real checkboxes with real labels — focusable, Space-operable, and announced with their checked state — and a card on the board face is reachable by Tab and opens with Enter or Space.

## [0.8.0] — 2026-07-20

- One renderer for every content block. Card comments now render full GitHub Flavored Markdown, Mermaid, and PlantUML — the same pipeline as card descriptions, decision records, and docs. File references like `src/core/store.ts:12` in descriptions and comments are one-click links that open the file at that line.

## [0.7.0] — 2026-07-17

- **Rich markdown** stated and verified: cards, decisions, and docs render full GitHub Flavored Markdown (tables, task lists, strikethrough, autolinks), Mermaid diagrams, and PlantUML through a configurable server. Card descriptions render as markdown in the card view.
- **Reading width** accepts a preset (`narrow`, `wide`, `full`) or any fixed CSS length such as `500px`, `90%`, or `60rem`, applied to the reading views and the card view.
- **Comment author** — the card comment composer has an author field, prefilled from `repodoc.commentAuthor` (falling back to your git name) and editable per comment; edits persist.
- **Board resilience** — the board webview builds each render into a detached fragment and only swaps it in on success, so an unexpected card can no longer blank the board or freeze later actions; render and message failures are logged for diagnosis.
- Added an end-to-end test suite that drives every board action through the real webview channel and asserts the resulting filesystem change and immediate refresh.
- Moved the Development section into `CONTRIBUTING.md`.

## [0.6.3] — 2026-07-17

- Rewrote the README and Marketplace description in a plain, neutral voice focused on the core value: in-repository task management that travels with the code.

## [0.6.2] — 2026-07-17

- Simplified PlantUML configuration back to a single setting: `repodoc.plantUmlServer`. The managed-Docker renderer mode, its settings, commands, and status-bar indicator are removed; the setting's description now shows the one-line `docker run` command for self-hosting a private renderer and the URL to set (`http://localhost:8792`).

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
