/**
 * Shared data model for RepoDoc.
 *
 * All data lives inside the repository:
 *  - `boards/<id>/.config.json`   — board name, columns, labels, agents
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

export interface AgentDef {
  name: string;
  color: string;
  initials: string;
}

export interface RepoDocConfig {
  labels: Record<string, LabelDef>;
  agents: Record<string, AgentDef>;
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
  /** Key into RepoDocConfig.agents — the agent assigned to this card. */
  agent?: string;
  /** True while an agent is actively working the card. */
  live?: boolean;
  /** Live status line, e.g. "editing src/payments/stripe.ts". */
  status?: string;
  /** Live progress 0-100. */
  progress?: number;
  comments?: number;
  desc?: string;
  checklist?: ChecklistItem[];
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
  /** Full markdown body. */
  body: string;
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
