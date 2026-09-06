/**
 * Shared data model for RepoDoc.
 *
 * All data lives inside the repository:
 *  - `boards/<id>/.config.json`   — board name, columns, labels
 *  - `boards/<id>/NN-slug.md`     — one card per file (frontmatter + markdown)
 *  - `decisions/NN-slug.md`       — decision records (markdown)
 *  - `docs/**`                    — documentation tree (plain markdown)
 *
 * The in-memory shapes below (BoardData/Column/Card) are what the webview and
 * panels consume — columns carry derived `cardIds`, cards are keyed by id.
 */

export interface LabelDef {
  name: string;
  color: string;
}

export type CustomFieldType = 'text' | 'number' | 'boolean' | 'date' | 'select' | 'multiselect';

/** A board-defined card field, declared in `.config.json` `fields`. */
export interface CustomFieldDef {
  /** Frontmatter key. Must not collide with the reserved card keys. */
  id: string;
  /** Display label — falls back to a title-cased id. */
  label?: string;
  type: CustomFieldType;
  /** Choices for select/multiselect. */
  options?: string[];
  /** Show the value as a chip on the card face. */
  showOnCard?: boolean;
}

export type CustomFieldValue = string | number | boolean | string[];

/**
 * A named condition on a column transition, declared per column in config.
 * Exactly one of `script` / `field` is set:
 *  - script: a command that must have run green; satisfied by a done evidence
 *    line for the gate id in the card's `## Gates` section.
 *  - field: evaluated live against the card's (custom or reserved) field value
 *    using the `check` mini-syntax: absent → nonempty; `empty` | `nonempty` |
 *    `= v` | `!= v` | `> n` | `>= n` | `< n` | `<= n` | `contains v` |
 *    `match <regex>`.
 */
export interface GateDef {
  id: string;
  /** Human label — falls back to the id. */
  label?: string;
  /** The command this gate requires a green run of. */
  script?: string;
  /** The custom-field (or reserved-field) id the gate inspects. */
  field?: string;
  /** Field check expression (see mini-syntax above). */
  check?: string;
}

/**
 * One entry of the card's `## Comments` journal section:
 * `- **who** (ISO time): text`. Agents journal their work here; text may
 * reference files as `path/to/file.ts:12` or `:12-34`, which the UI renders
 * as one-click links opening the file at that highlighted range.
 */
export interface CommentEntry {
  who?: string;
  at?: string;
  text: string;
}

/** One line of the card's `## Gates` section: `- [x] <gateId> — <note>`. */
export interface GateEvidence {
  gateId: string;
  done: boolean;
  note?: string;
}

/** The evaluation of one gate for a proposed transition. */
export interface GateResult {
  gate: GateDef;
  satisfied: boolean;
  /** Human-readable reason, e.g. "checklist 3/5" or "no approval by jonathan". */
  reason: string;
}

export interface RepoDocConfig {
  labels: Record<string, LabelDef>;
  /** Board-defined card fields, in display order. */
  fields: CustomFieldDef[];
}

export interface ChecklistItem {
  text: string;
  done: boolean;
}

export type Priority = 'high' | 'med' | 'low';

export interface Card {
  id: string;
  title: string;
  labels?: string[];
  priority?: Priority;
  /**
   * Free text naming who is working the card (e.g. "claude"). Renders as a
   * derived avatar — there is no roster; any writer may add themselves.
   */
  agent?: string;
  /** True while an agent is actively working the card. */
  live?: boolean;
  /** Live status line, e.g. "editing src/payments/stripe.ts". */
  status?: string;
  /** Live progress 0-100. */
  progress?: number;
  /** Journal entries from the card's `## Comments` section, in file order. */
  comments?: CommentEntry[];
  desc?: string;
  checklist?: ChecklistItem[];
  /** Values of board-defined custom fields, keyed by field id, typed per def. */
  custom?: Record<string, CustomFieldValue>;
  /** Parsed `## Gates` section lines (evidence for command/approval gates). */
  gates?: GateEvidence[];
  /** ISO timestamp of the last change. */
  updatedAt?: string;
}

export interface Column {
  id: string;
  name: string;
  /** Header dot color, e.g. "#4c8bf5". */
  color: string;
  /** Optional WIP limit. */
  wip?: number;
  /** Gates a card must satisfy to move INTO this column. */
  enter?: GateDef[];
  /** Gates a card must satisfy to move OUT of this column. */
  exit?: GateDef[];
  /** Ordered card ids. */
  cardIds: string[];
}

export interface BoardData {
  name: string;
  columns: Column[];
  cards: Record<string, Card>;
}

export interface BoardRef {
  id: string;
  name: string;
  cardCount: number;
}

export interface DecisionRecord {
  /** Stable id — the file name without extension. */
  id: string;
  /** Number as written in the file name, e.g. "01". */
  num: string;
  /** File name, e.g. "01-record-decisions.md". */
  file: string;
  title: string;
  /** "Accepted" | "Proposed" | "Superseded" (free-form, from the markdown). */
  status: string;
  /** Decision date (frontmatter `date:`), verbatim. */
  date?: string;
  /** Full markdown body (frontmatter excluded). */
  body: string;
  /** All frontmatter keys, verbatim — rendered as a table in the reading view. */
  frontmatter?: Record<string, unknown>;
}

export interface DocNode {
  type: 'dir' | 'file';
  /** File-system name. */
  name: string;
  /** Display label — first `# ` heading for files, title-cased name for dirs. */
  label: string;
  /** Path relative to the workspace root, e.g. "docs/guides/agents.md". */
  relPath: string;
  children?: DocNode[];
}
