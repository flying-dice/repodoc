# UI parity sweep — VS Code extension vs CLI vs hand-editing

Date: 2026-09-06. Author: Designer (bot), on Lead's brief.
Sources read: `packages/vscode/{package.json,src/extension.ts,src/trees.ts,src/panels/*.ts,media/board.js,media/board.css,media/base.css,media/markdown.css}`, `packages/cli/src/commands.ts` (current on-disk state, including the new per-gate `prompt` output), `packages/core/src/{types.ts,store.ts,gates.ts,boardConfig.ts,skillContent.ts}`, `docs/03-reference/*.md`, `decisions/05..08`, and both dogfood boards.

Every claim about current behaviour cites `file:line`. Line numbers are as of this sweep; `board.js` has no build step, so they are stable until someone edits the file.

## 0. Framing

RepoDoc's contract is "files are the truth; the extension, the CLI and an agent's editor are three clients of the same store" (`decisions/09`, `skillContent.ts:20-22`). The sweep asks: can a human at the VS Code UI do what an agent can do through `repodoc <cmd>` or by editing `boards/<id>/NN-slug.md`?

Short answer: the UI is a good **reader** and a partial **mover**, but for most **writes** it is behind the CLI, and the CLI is itself behind hand-editing. Worse, the UI offers no path to the fallback: there is no way to open a card's file, the board config, a decision or a doc's source from any RepoDoc surface. So when the UI cannot do something, the human is stranded, whereas an agent simply edits the file.

## 1. Parity matrix

Legend: **yes** = a first-class action; **partial** = possible with a caveat noted; **no** = not possible on that surface. "Hand edit" is always yes for anything the parser reads, so that column mostly records *what* the parser reads. UI evidence points at the code that proves the cell (or, for a "no", the code that shows the surface is read-only and the protocol has no message for it — see `protocol.ts:513-521` for the complete webview→host message list).

### 1.1 Cards

| Capability | CLI | Hand edit | VS Code UI | UI evidence |
|---|---|---|---|---|
| Create card (title, in a column) | yes `card create` (`commands.ts:166-190`, also sets priority/labels/agent) | yes | **partial** — title only, from the column composer; no priority/labels/agent at creation | `board.js:679-737` composer; `boardPanel.ts:265-273` → `store.addCard` |
| Move card to another column | yes `card move` (`:191-231`) | yes (`column:` key) | yes — drag & drop | `board.js:1569-1592`; `boardPanel.ts:295-325` |
| Reorder within/into column at an index | yes `--index` | partial (must renumber all `NN-` prefixes by hand — the skill forbids agents doing this, `skillContent.ts:223-225`) | yes — drop position | `board.js:1531-1537` `absoluteDropIndex` |
| Set / change title | yes `card update --title` (`:540-546`) | yes (`# ` heading) | **no** — static text | `board.js:832` `modal-title` is a plain div; no message type in `protocol.ts` |
| Labels | yes `--labels a,b` / `""` clears | yes | **no** — display only | chips `board.js:458-464, 509-514, 826`; no editor |
| Priority | yes `--priority` | yes | **no** — display only | `board.js:856-863` static pill |
| Agent | yes `--agent` | yes | **no** — avatar only | `board.js:582-591` face avatar, `:850` in live banner |
| Live flag | yes `--live true/false` | yes | **no** | `board.js:533-547` render only |
| Status line | yes `--status` | yes | **no** | `board.js:539, 846` render only |
| Progress | yes `--progress n` | yes | **no** | `board.js:534-545, 850` render only |
| Description (body text) | **no** (not in `CardMetaPatch`, `store.ts:46-54`) | yes | **no** — rendered only; section hidden when empty so there is no "add" affordance either | `board.js:865-872` |
| Custom field set/clear (all six types) | yes `card set` (`:297-321`) | yes | **yes** | `board.js:1150-1248` editors, `:1250-1265` section; `boardPanel.ts:209-228` |
| Checklist: toggle item | yes `card check <i>` | yes | **yes** | `board.js:884-903`; `boardPanel.ts:278-283` |
| Checklist: add item | **no** | yes | **no** | `board.js:874-911` renders existing items only |
| Checklist: edit / delete / reorder item | no | yes | **no** | same |
| Comment: append journal entry | yes `card comment` | yes | **yes** (author editable, persisted to setting) | `board.js:1060-1073, 1090-1131`; `boardPanel.ts:229-244` |
| Comment: edit / delete | no (append-only by design, `decisions/08`) | yes | no | — |
| Gate evidence (record green script run) | yes `card gate-pass` (`:248-261`) | yes (`## Gates` line) | **no** — modal shows "Run: <script>" with no action | `board.js:1278-1284` `gateNote`; no `recordGateEvidence` caller in `boardPanel.ts` |
| Gate override | yes `card move --override --reason <why>` — reason is **required** (`:209-213`) | yes (`OVERRIDDEN` line) | **partial** — only reachable after a blocked drag; records **no reason**; identity is git-derived, not the configured comment author | `board.js:1383-1396, 1433-1436`; `boardPanel.ts:318-323` calls `recordGateOverride(..., who)` with no `reason`; `store.ts:449-458` accepts one |
| See gate status before moving | yes `card gates` (prints `prompt` per failing gate, `:232-247, 481-489`) | n/a | **partial** — modal Gates section shows pass/fail + a one-line note; card face shows exit-gate count; column header shows a shield with tooltip. **No `prompt` anywhere** | `board.js:1288-1338` modal; `:480-503` face chip; `:632-645` header glyph; `grep prompt board.js` → none |
| Read column `prompt` (what to do once a card is here) | yes `board show` (`:74-76`), `card move` prints it on arrival (`:224-226`) | n/a | **no** | not in `DataMessage` consumers; `board.js` never reads `col.prompt` (it *is* delivered, `store.ts:191`) |
| Delete / archive card | **no** (store never deletes, `store.ts:270`) | yes (delete file) | **no** | — |
| Open the card's file | n/a (`card show` prints content) | n/a | **no** — the only `openFile` path is a `path:line` token inside a comment | `boardPanel.ts:245-264, 332-355`; `board.js:920-938` |
| Search / filter | `card list --column` | n/a | partial — title substring only; labels, agent, status, fields are not searched | `board.js:206-212` |

### 1.2 Columns and board config

| Capability | CLI | Hand edit | VS Code UI | UI evidence |
|---|---|---|---|---|
| Create board (default columns + labels) | yes `board create` | yes | **yes** — "New Board" input box | `extension.ts:407-417`; `package.json:93-98, 124-128` |
| Rename board | no | yes (`name`) | **no** | — |
| Add column (name only; colour fixed `#7d828b`) | yes `column add` | yes | **yes** — "+ Add another list" → input box | `board.js:749-760`; `boardPanel.ts:274-276, 357-362`; `store.ts:251-256` |
| Rename / recolour / reorder / delete column | no | yes | **no** | column head is static, `board.js:628-653` |
| WIP limit set/change | no | yes (`wip`) | **no** — display only, and the displayed count is of *filtered* cards (see D-11) | `board.js:648-653` |
| Enter/exit gates: define / edit / add `prompt` | no | yes | **no** | — |
| Column `prompt` define | no | yes | **no** | `boardConfig.ts:134-136` parses it; nothing writes it |
| Labels: define / recolour / delete | no | yes | **no** | `config().labels` read-only, `board.js:412-415` |
| Custom field definitions (`fields`) | no (CLI refuses unknown field, `:303-306`) | yes | **no** | `fieldDefs()` read-only, `board.js:220-223` |
| Open `.config.json` | n/a | n/a | **no** — status bar shows the path as plain text | `board.js:790-795` |
| Init workspace | yes `init` | yes | yes | `extension.ts:324-335` |
| Install agent skill | yes `skill install` | yes | yes (quick pick) | `extension.ts:433-462` |

### 1.3 Decisions

| Capability | CLI | Hand edit | VS Code UI | UI evidence |
|---|---|---|---|---|
| List / read | yes | yes | yes — tree + reading view | `trees.ts:599-624`; `markdownPanel.ts:657-686` |
| Create (skeleton, `status: Proposed`, dated) | yes `decision create` | yes | yes — "New Decision" input box | `extension.ts:419-431` |
| Change status (Proposed → Accepted → Superseded) | **no** | yes | **no** — frontmatter rendered as a read-only table | `markdownPanel.ts:664, 757-774` |
| Edit body | no | yes | **no** — reading view has no edit/open-source affordance | `markdownPanel.ts:714-746` (topbar has crumb only; `filecrumb` at `:731` is plain text) |
| Open the `.md` file | n/a | n/a | **no** | tree item command is `openDecision` only, `trees.ts:610-614`; no `view/item/context` entry in `package.json:154-160` |

### 1.4 Docs

| Capability | CLI | Hand edit | VS Code UI | UI evidence |
|---|---|---|---|---|
| Browse tree / read page | yes `docs tree` / `docs show` | yes | yes | `trees.ts:639-673`; `markdownPanel.ts:688-712` |
| Create page / folder | no | yes | **no** — welcome text tells the user to "drop in a `.md` file" | `package.json:60-63` |
| Edit page / open source | no | yes | **no** | same as decisions |

### 1.5 Summary of where the UI is *behind the CLI*

Title, labels, priority, agent, live, status, progress (`card update`); gate evidence (`gate-pass`); override *reason*; gate and column `prompt` text; priority/labels/agent at creation. Everything else the UI lacks, the CLI lacks too (description, checklist authoring, column/label/field/gate config, decision status, docs authoring, delete) — those are "hand edit only", and the UI offers no route to the file.

## 2. Ranked gaps and usability defects

Severity: **blocker** = a routine human task cannot be completed from the UI and there is no in-UI escape hatch; **major** = capability gap with an awkward workaround (leave VS Code's RepoDoc views, find the file in Explorer); **minor** = polish / consistency.

Recommendations name the surface, the interaction, and what gets written. Where a new webview→host message is needed I name it, but message shapes are Lead's call.

### G-1 · blocker · No route from any RepoDoc surface to the underlying file

**Symptom.** A card modal, a decision view, a docs page, and the board status bar all *name* their file (`board.js:790-795` shows `boards/<id>/`; `markdownPanel.ts:731` shows `decisions/NN-slug.md`) but none is clickable. Since every other gap below falls back to "edit the file", this one multiplies all of them.

**Recommend.**
- Card modal header (`board.js:825-837`): add a ghost icon button "Open file" beside the close button. Sends the existing `openFile` message with the card's path (`boards/<id>/<NN>-<slug>.md`); the host already containment-checks and opens (`boardPanel.ts:332-355`). The webview does not currently know the file name (only the slug) — the host should add `fileName` per card to `DataMessage`, or resolve slug→file host-side in a new `openCard` handler.
- Boards tree: add `view/item/context` entries for `viewItem == repodoc.card` ("Open Card File") and `repodoc.board` ("Open Board Config") in `package.json` next to `:154-160`. Card nodes already carry `contextValue = 'repodoc.card'` (`trees.ts:540`).
- Board status bar: make the `status-datadir` path a link that reveals `boards/<id>/.config.json` (`board.js:794`).
- Decision and doc reading views: add "Open source" to the topbar right side (`markdownPanel.ts:721-728`), opening the `.md` in an editor beside the view. Also add it as an inline action on Decisions/Docs tree items.

This is the cheapest change in the list and it unblocks every "hand edit only" cell.

### G-2 · blocker · Reserved card metadata is read-only in the UI

**Symptom.** An agent can `card update --title/--priority/--labels/--agent/--live/--status/--progress` (`commands.ts:262-277`). A human sees the same values as static chips and pills (`board.js:509-591`, `856-863`) and cannot change any of them. A fresh card from the composer has no priority, no labels, no owner, and the human has no way to add them. The store already exposes `updateCardMeta` (`store.ts:313-332`); only the webview and one host `case` are missing.

**Recommend.** One new message, `updateMeta { cardId, patch: CardMetaPatch }`, handled in `boardPanel.ts:onMessage` by validating each key and calling `store.updateCardMeta`. In the modal:
- **Title** (`board.js:832`): click-to-edit. Title becomes a single-line input on click; Enter saves (`patch.title`), Escape reverts, blur saves. Same pattern as the text field editor (`:1229-1247`), which already posts on `change` to keep focus.
- **Priority** (`:856-863`): replace the static pill with a `field-select` (`board.css:685`) offering None / Low / Medium / High. Empty → `priority: null`.
- **Labels**: a new "Labels" row in the `modal-cols` grid rendering `config().labels` as toggle chips, reusing the multiselect `ms-chip` pattern (`:1201-1225`) but tinted with the label's own colour via `tintStyle` (data colour, per `decisions/05`). Posts `labels: [...]` or `null`.
- **Owner / live / status / progress**: the live banner (`:839-854`) currently renders only when `card.live`. Replace with an always-present "Activity" row: agent text input (placeholder "who is on this"), a live toggle reusing `field-bool` (`:1154-1173`), and — when live — status text input and progress number input (0-100). Posts the corresponding patch keys; clearing sends `null`, matching the CLI's `""`-clears convention (`commands.ts:262`).
- **Composer** (`:679-727`): leave as title-only. The skill's "claim it" flow sets metadata *after* creation; humans can do the same in the modal. Do not grow the composer.

### G-3 · major · Blocked-move dialog is a "no" with no workflow

**Symptom.** Drop a card onto a gated column and you get a list of gate labels plus a machine-phrased reason (`gates.ts:114`: "no recorded green run of \`bun run test\`"; `:124`: "peer-reviewed = true (currently: unset)") and two buttons (`board.js:1398-1441`). The CLI now prints, per failing gate, the gate's `prompt` (or a generated default) and tells the agent exactly how to record the result (`commands.ts:496-516`). The human gets none of that, cannot record a script run from the UI at all (no `recordGateEvidence` caller in `boardPanel.ts`), and for field gates is told "set via Fields above" only inside the *card modal* (`board.js:1297-1301`), not in the dialog that just stopped them. Full treatment in section 3.

### G-4 · major · Override captures no reason; CLI requires one

**Symptom.** "Override & move" (`board.js:1434`) writes `OVERRIDDEN (<git user>, <time>)` with no reason (`boardPanel.ts:318-323`); the CLI refuses `--override` without `--reason` (`commands.ts:209-211`). The audit trail (`decisions/06`, "an override is a recorded act") is weaker when a human does it than when an agent does. The identity also differs: overrides use `localIdentity` directly (`boardPanel.ts:319`) while comments use the `repodoc.commentAuthor` setting first (`:381-386`).

**Recommend.** In the blocked dialog add a required single-line "Reason" input above the actions; "Override & move" stays disabled until it is non-empty. Extend `MoveCardMessage` with `reason?: string` (`protocol.ts:458-465`), and have `handleMove` pass it to `recordGateOverride` and use `resolveCommentAuthor` for `who`, so the two hosts write identical lines.

### G-5 · major · Column and board configuration is invisible and uneditable

**Symptom.** WIP, gates, prompts, colours, labels and field definitions are the board's process, but the UI shows them only as side-effects (a shield glyph with a tooltip, `board.js:632-645`; a WIP fraction, `:648-653`) and edits none. Neither does the CLI, except `column add`. A human who wants a `peer-reviewed` field or a `prompt` on the Review column must know the JSON schema from `docs/03-reference/01-file-formats.md`.

**Recommend.** Do **not** build a config form yet — it would be a large new pattern. Instead:
1. Ship G-1's "Open Board Config" everywhere (status bar, board tree item, column header context menu).
2. Add a column header hover/context affordance (a `…` button appearing on `.col-head:hover`) with: Rename, Set WIP limit (input box, empty clears), Edit in config (opens `.config.json` at the column's line). Rename and WIP are one-key JSON edits the store can do safely; add `renameColumn`/`setColumnWip` alongside `addColumn` (`store.ts:251-256`). Gate/prompt/label/field authoring stays in JSON, reached via "Edit in config".
3. Unify vocabulary: the webview says "list" (`board.js:758`, `boardPanel.ts:358` prompt "List name") while the CLI, config and docs say "column". Use "column".

### G-6 · major · Checklist items cannot be added or edited

**Symptom.** Humans can only toggle (`board.js:884-903`). Agents hand-edit `- [ ]` lines; the CLI cannot add either. A human decomposing a card into steps must leave the UI.

**Recommend.** Under the checklist (or in place of the section when it is empty) an "Add item" inline composer: single-line input, Enter adds, Escape cancels — same behaviour as the card composer (`:687-695`). New message `addChecklistItem { cardId, text }`; new store method appending `- [ ] <text>` to `## Checklist` (creating the section after the description when absent, mirroring `appendCommentLine`'s create-if-missing logic, `store.ts:689-720`). Recommend the CLI get `card check-add` at the same time so the two hosts stay level. Editing/deleting item text: defer; "Open file" (G-1) is an acceptable fallback.

### G-7 · major · Description cannot be written or edited

**Symptom.** The description renders as markdown (`board.js:865-872`) and is hidden when empty, so a new card offers nowhere to write what it is about. Neither host can write it; only hand-edit.

**Recommend.** Always render the Description section. Empty state: a muted "Add a description…" placeholder that, on click, becomes a textarea; when non-empty, a small "Edit" ghost button in the section header toggles the same textarea. Cmd/Ctrl+Enter saves, Escape cancels (same keys as the comment composer, `:1097-1106`). New message `setDescription { cardId, text }`; store method replaces the body between the `# ` title and the first `## Checklist|Gates|Comments` heading (`cardParse.ts` already defines that span). Markdown preview stays host-rendered as today.

### G-8 · major · Decisions and docs are read-only in the UI

**Symptom.** A human can create a decision skeleton (`extension.ts:419-431`) but cannot fill it in, cannot change its status, and cannot create or edit a doc page from RepoDoc's own views. The Decisions tree colours by status (`trees.ts:626-637`) but offers no way to change it.

**Recommend.**
- "Open source" in both reading views and as inline tree actions (part of G-1).
- Decisions tree item context menu "Set Status…" → quick pick Proposed / Accepted / Superseded → writes frontmatter `status:` (small `DecisionStore` method). Mirror it in the CLI (`decision status <id> <value>`).
- Docs tree title bar: "New Doc" (`$(add)`) prompting folder + title, writing `docs/<folder>/<NN>-<slug>.md` with a `# Title` heading, then opening it in the editor. The welcome text at `package.json:60-63` currently tells users to do this by hand.

### G-9 · major · Cards cannot be removed or archived on any surface

**Symptom.** No delete anywhere (`store.ts:270` "never delete"). Humans doing housekeeping must delete files in Explorer, which the extension picks up fine via the watcher (`extension.ts:269-277`).

**Recommend.** Do not add delete to the webview yet — destructive actions deserve a decision record (what happens to `NN-` numbering, whether "archive" is a column or a folder). Until then, G-1's "Open file" plus VS Code's own Explorer is the workaround. Flagged under Decisions Needed.

### Defects (minor unless marked)

- **D-1 · minor** — Priority pill shows **"Medium"** when a card has no priority: `PRIORITY_LABELS[card.priority] || PRIORITY_LABELS.med` (`board.js:858`) while the colour falls back to *low* (`:857`), and the card face shows no dot at all for unset/low (`:517`). Fix: label fallback "None", pill muted; or hide the pill when unset (once G-2 makes it editable, show a "None" select value).
- **D-2 · minor** — Column count and WIP state are computed over **search-filtered** cards (`board.js:646-653`), so typing in the search box can flip a column from "4/3 over" to "1/3". Count all `col.cardIds`, and show "n of N" only while a filter is active.
- **D-3 · minor** — Search matches title only (`board.js:206-212`). Labels, agent, status, and `showOnCard` field values are all visible on the face but not searchable. Extend `matches()` to those strings.
- **D-4 · minor (accessibility)** — Card modal and blocked dialog have no Escape-to-close, no focus trap, no `role="dialog"`/`aria-modal`; the only `Escape` handlers are the two composers (`board.js:691, 1101`). Close button is a `✕` text glyph with no `aria-label` (`:834, 1428`). Add a document-level keydown (Escape → `closeBlocked()` first, then `closeModal()`), focus the panel on open, and label the buttons.
- **D-5 · minor** — Escape in the comment composer **wipes typed text** without confirmation (`board.js:1101-1105`); the card composer's Escape merely cancels an empty box. Make Escape blur the field; keep text.
- **D-6 · minor** — Modal "Gates" section lists "To enter <column>" for **every** other column, including columns behind the card (`board.js:1311-1318`); a card in Done shows requirements for entering Backlog. Show exit gates of the current column and enter gates of the *next* column by default, with "Show all transitions" disclosure.
- **D-7 · minor** — Agent is shown in the modal **only while live** (`board.js:850`); when not live the owner is visible on the face (`:582-591`) but nowhere in the detail view. Resolved by G-2's Activity row.
- **D-8 · minor** — Live banner reads "0% complete" when `progress` is unset (`board.js:850`, `:534`). Omit the percentage when undefined.
- **D-9 · minor** — Column gate glyph (`board.js:632-645`) and exit-gate chip (`:480-503`) carry their content only in `title=` tooltips: invisible to keyboard and touch, and the face chip covers *exit* gates only. Section 3 proposes where this information should live instead.
- **D-10 · minor** — Invalid number in a number field silently **clears** the value (`board.js:1238-1240` posts `null` on NaN). Reject the edit and restore the previous value instead.
- **D-11 · minor** — Boards tree card nodes have `contextValue` (`trees.ts:540`) but no menu items (`package.json:154-160`); clicking opens the modal, which is right, but there is no secondary action (open file, copy id). Ties to G-1.
- **D-12 · minor** — `agentAvatar` colour is a hash of the name (`board.js:189-204`) while the legacy `agents` block in `boards/project-backlog/.config.json` (with explicit colours) is ignored by `normalizeBoardConfig` (`boardConfig.ts:94-111`). Stale seed data, not a UI bug; noted for Lead.

## 3. Surfacing workflow gates and their `prompt` to a human

### What the CLI now does

On a refused move the CLI prints, for each failing gate: `n. <label> (<id>) — <reason>`, then the gate's `prompt` verbatim (or a default: "Run `<script>` and, only if it exits 0, record the result with gate-pass" / "Set the `<field>` field so that it satisfies `<check>`"), then a footer telling the caller how to record evidence or set the field, and that only a human may override with a reason (`commands.ts:496-516`). `card gates` prints prompts for failing gates too (`:481-489`). After a successful move it prints the target column's `prompt` under "Now that <card> is in <column>:" (`:224-226`).

### Principle

The human should receive the same three things the agent does, at the same moments: **what is required**, **how to satisfy it** (the `prompt`), and **how to record it** — and the recording should be an in-place action, not a hint to go elsewhere. Gates are the board's process; they should read as guidance, not as an error.

### Data the webview needs

`MoveBlockedGate` today carries `id, label, satisfied, reason` (`protocol.ts:433-438`). Add `kind: 'script' | 'field'`, `script?`, `field?`, `check?`, `prompt?` (and `promptHtml?` if rendered host-side — see below). `Column` already delivers `enter/exit` `GateDef`s including `prompt` (`store.ts:189-191`, `types.ts:46-62`), so the card modal can read prompts without protocol changes.

Prompts are authored markdown-ish text (multi-line, may contain commands and file paths). Render them with the shared renderer host-side like descriptions (`boardPanel.ts:152-166`) and enhance with `linkifyElement` so `path:line` references in a prompt become one-click links (`board.js:980-1008`). This keeps one renderer for every content block (`CHANGELOG 0.8.0`).

### Surface 1 — the blocked-move dialog (the moment of refusal)

Restyle `buildBlockedDialog` (`board.js:1398-1441`) from an error into a checklist:

- **Title**: "Before *<card title>* can move to <Column>" instead of "Can't move to". Keep the `blocked-modal` width but allow it to grow to `width-wide` when any prompt is present.
- **One block per failing gate** (reuse `gate-row` styling, `board.css:765-812`):
  - status glyph (empty circle, as now) · **label** · small muted `id`.
  - the human `reason`, reworded per kind (D-9): script → "No recorded green run of `bun run test`"; field → "Peer reviewed is unset — needs to be true".
  - **prompt** rendered as a `content-md` block, or the default prompt text when absent (same fallback rule as the CLI, `commands.ts:511-516`).
  - **action row**, by kind:
    - *script gate*: the command in a `code` chip with a "Copy" button, plus **"Record a green run…"** which reveals an inline single-line input ("What ran and what happened, e.g. `bun test green, 130 unit + 9 e2e`") and a "Record" button. Sends new `recordGatePass { cardId, gateId, result }`; host calls `store.recordGateEvidence(..., who=resolveCommentAuthor)`. The row re-evaluates live on the next `data` message (the gate turns green in place). Copy uses the honesty wording from the skill: "Only record a run that actually passed" as helper text under the input.
    - *field gate on a declared custom field*: embed the field editor **inline** (`fieldEditor(def, card)`, `board.js:1150-1248`) right in the row. A boolean approval becomes a single click; a select becomes the dropdown. This removes the "set via Fields above" indirection (`:1300`).
    - *field gate on a reserved field* (`status`, `priority`, …): show the current value and, once G-2 lands, the same inline editor.
    - *human sign-off heuristic*: when the field id matches the skill's heuristic (`peer-reviewed`, `approved-by`, … `skillContent.ts:210-214`) add a muted note "This is a sign-off — set it only if you are the reviewer." Nothing is enforced; it mirrors what the agent is told.
- **Footer**: "Move" button (primary) that re-sends the stashed `lastMove` (`:1383-1396`) *without* override, enabled once every row is satisfied (client-side `gateSatisfied`, host re-validates); "Override…" (secondary) that expands a required Reason input (G-4) and then "Override & move"; "Cancel". Today's ordering — Cancel as primary (`:1435`) — is right for an error dialog but wrong for a guided one; make the *satisfying* path primary.
- Keep the dialog open across `data` refreshes so a human can tick two gates in a row; close on Move/Cancel only.

### Surface 2 — the card modal Gates section (before the drag)

`modalGates` (`board.js:1305-1338`) already lists rows with pass/fail. Add:
- Show only the **current column's exit** and the **next column's enter** gates by default (D-6), headed "To leave In Progress" / "To enter In Review", with a "Show all transitions" disclosure for the rest.
- Each unsatisfied row gets a collapsed **"How to satisfy"** disclosure containing the rendered prompt and the same kind-specific action row as Surface 1 (record run / inline field editor). Satisfied rows show the evidence note and who/when, as today (`:1279-1282`).
- A **"Move to <next column>"** button at the section foot, enabled when all listed gates pass; posts `moveCard` with `index = MAX_SAFE_INTEGER` (bottom of column, the CLI default, `commands.ts:201`). This gives keyboard users a move that does not require drag and drop.

### Surface 3 — the column header (at a glance)

Replace the tooltip-only shield (`board.js:632-645`) with a small chip "2 enter · 1 exit" that opens a popover listing each gate: label, kind glyph (`$(terminal)` for script, `$(symbol-field)` for field, expressed as inline SVG like `ICON`), and the first line of its prompt. Read-only; the popover's footer has "Edit in config" (G-5). This is the human's equivalent of `board show`.

### Surface 4 — the column `prompt` after a successful move

`card move` prints "Now that <card> is in <Column>: <prompt>" (`commands.ts:224-226`). For a human, the equivalent moment is right after the drop. Recommend **not** a toast (VS Code notifications are outside the board and easy to miss) but:
- In the card modal, directly under the header badges (`board.js:825-837`), an "In this column" panel showing the column's rendered `prompt`, dismissible per card+column (remember in webview state, not on disk).
- On the card face, for the first render after a move into a column with a prompt, a subtle one-line hint "New here — see what to do" that opens the modal. Drop it after the card has been opened once.

### Copy and tone

Use the CLI's sentence shapes so agents and humans read the same words: "N gates must be satisfied first", "Do the work above, then move again", "Only record a run that actually passed", "Only a human may override — say why". Theme tokens only: pass = `--vscode-charts-green` (already `gate-status.ok`, `board.css:785`), pending = `--vscode-descriptionForeground`, override = `--vscode-editorWarning-foreground`.

## 4. A second board kind: Gherkin feature sets

**Premise (from the brief).** `features/<set>/*.feature` files, one status per file, shown on the same kanban surface. Where the status is stored is not decided; I assume a set-level config (`features/<set>/.config.json`, same `columns/labels` shape as a board) and a per-file status mapping whose storage is Lead's call (see Decisions Needed). Everything below holds regardless of that choice.

### What stays the same

Columns = statuses, one per config column; drag between columns writes the status; column gates, WIP, prompts, header chips and the blocked dialog all reuse the board machinery unchanged. Reading width, theme tokens, the modal shell, `content-md` blocks — all reused. A feature set appears in the Boards tree beside boards with a distinct icon (`$(beaker)`) and the same column → item nesting (`trees.ts:488-586`).

### What differs, and why

Feature files are **owned by a test runner**, not by RepoDoc. Their names, order and content mean something to Cucumber. So:
- **No renumbering, no within-column reorder.** Cards sort by file name (or by `Feature:` title, a toggle) and the drop index is ignored. Drop feedback should show a column-wide highlight (`.column.drag-target`, `board.css:106`) with no placeholder slot, so the interaction does not promise an order it will not keep.
- **No composer.** New features are written in the editor; the column footer offers "Open folder" instead of "+ Add a card". (Creating a stub `.feature` from a title is defensible but it is a runner-format decision; not proposed now.)
- **No journal written into the file.** Gherkin `#` comments are the only place text could go and that would pollute test source. Comments/checklist/custom fields are either absent or live in the sidecar — Lead's call. Default: absent.
- **Gate evidence** for a feature (e.g. "scenarios green") needs a home; if there is a sidecar, `## Gates` lines go there; if not, script gates are evaluated but cannot be recorded, so they should be omitted from feature-set configs until the sidecar exists.

### Card face

- **Title**: the `Feature:` line's text. Fallback: file name without extension, title-cased (mirrors `markdownTitle` fallback for cards).
- **Subtitle** (muted, mono): relative path `features/<set>/<file>.feature`.
- **Tag chips**: Gherkin `@tags` on the Feature line rendered as label chips; colours from the set's `labels` map when the tag is declared there, else a neutral `field-chip` style. Untagged features show none.
- **Meta row**: `$(list-flat) 5 scenarios` (count of `Scenario` + `Scenario Outline`, outlines counted once with "×N examples" in the tooltip); a `Background` glyph when present; a `Rule` count when the file uses `Rule:` blocks; `updated` from file mtime; no avatar.
- **Optional result chip** when a runner report exists (not proposed for v1; noted so the slot is reserved): "12/14 passed" in `--vscode-charts-green/red`.
- No priority dot, no live block, no checklist fraction.

### Detail view (modal)

- Header: tag chips + status badge (`col-badge`), title, path with "Open file" (G-1 applies here as a must, not a nice-to-have — this is source code).
- **Description**: the free text under `Feature:` (before the first `Background`/`Scenario`), rendered as markdown via the shared renderer.
- **Scenarios**: an ordered list of collapsible rows, one per `Background` / `Scenario` / `Scenario Outline` / `Rule` (rules nest their scenarios one level). Row header: keyword in muted small caps, scenario name, scenario-level `@tags` as chips, step count. Expanded body: steps as a definition list with the keyword (`Given/When/Then/And/But`) right-aligned in `--vscode-textPreformat-foreground` and the step text in body colour; `"""` doc strings as `pre` blocks; data tables and Examples tables as real `table`s using `markdown.css` table rules. Default state: first scenario expanded, others collapsed; "Expand all".
- Steps should be keyword-highlighted, not syntax-coloured line-by-line; the goal is reading the behaviour, not editing it. Editing is always "Open file".
- **Gates**: same section as cards (section 3), evaluating the set's column gates against the feature's fields (if a sidecar exists) — otherwise hidden.
- No comments composer, no checklist, no Fields — unless the sidecar decision adds them.

### Actions that make sense

| Action | Where | Writes |
|---|---|---|
| Change status | drag between columns; "Move to <next>" in modal Gates | the per-file status (wherever Lead puts it) |
| Open file | modal header, tree context, card face double-click | nothing |
| Copy path / copy `cucumber-js <path>` | modal header overflow | nothing |
| Copy scenario as `--name` filter | scenario row overflow | nothing |
| Set tag-derived labels | none — tags are edited in the file | — |
| Record gate evidence / override | as section 3, only if a sidecar exists | sidecar `## Gates` |

### Recommendation on the storage question

The two candidates are (a) a status map inside `features/<set>/.config.json`, or (b) a sidecar `features/<set>/<file>.feature.md` per feature with frontmatter `status:` (and optionally `## Gates`, `## Comments`). From the UI's point of view (b) is the better fit: it makes a feature card *exactly* a card whose description is derived from the `.feature`, so the existing modal, gates, journal and CLI (`card move`, `gate-pass`, `comment`) work with almost no special-casing, and a human hand-editing has one obvious place to look. Cost: one extra file per feature. (a) is lighter on disk but pushes every write into one shared JSON file and leaves gates and journal homeless. This is Lead's decision; noted below.

---

## Appendix — proposed message additions (for Lead's review, not decided here)

| Message | Direction | Purpose | Gap |
|---|---|---|---|
| `updateMeta { cardId, patch }` | webview→host | reserved metadata edits → `store.updateCardMeta` | G-2 |
| `recordGatePass { cardId, gateId, result }` | webview→host | → `store.recordGateEvidence` | G-3 |
| `moveCard.reason?: string` | webview→host | override reason → `store.recordGateOverride(..., reason)` | G-4 |
| `addChecklistItem { cardId, text }` | webview→host | new store method | G-6 |
| `setDescription { cardId, text }` | webview→host | new store method | G-7 |
| `openCardFile { cardId }` (or `fileName` in `DataMessage`) | webview→host | reuse `openFile` | G-1 |
| `MoveBlockedGate.{kind, script?, field?, check?, prompt?, promptHtml?}` | host→webview | guidance in the blocked dialog | G-3 |

`protocol.ts:394-400` reminds that `board.js` mirrors these shapes by hand; each addition needs both sides.
