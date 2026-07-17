# Change Log

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
