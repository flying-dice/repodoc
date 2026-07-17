# Change Log

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
