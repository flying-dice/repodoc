/**
 * Board `.config.json` shape, defaults, and normalization. Pure and vscode-free:
 * `normalizeBoardConfig` turns arbitrary parsed JSON (or `undefined`) into a
 * trustworthy {@link BoardConfig} the store can rely on.
 */

import {
  CustomFieldDef,
  CustomFieldType,
  GateDef,
  LabelDef,
} from './types';
import { titleCase } from './naming';

/** A configured column as stored in `.config.json` (no derived card list). */
export interface ConfigColumn {
  id: string;
  name: string;
  color: string;
  wip?: number;
  /** Gates a card must satisfy to move INTO this column. */
  enter?: GateDef[];
  /** Gates a card must satisfy to move OUT of this column. */
  exit?: GateDef[];
}

export interface BoardConfig {
  name: string;
  columns: ConfigColumn[];
  labels: Record<string, LabelDef>;
  /** Board-defined card fields, in declaration order. */
  fields: CustomFieldDef[];
}

/**
 * Frontmatter keys RepoDoc owns on every card. A custom field may not reuse
 * one of these ids — doing so would let a field clobber (or masquerade as) a
 * built-in card property. Exported so the store and UI can share the guard.
 */
export const RESERVED_CARD_KEYS: ReadonlySet<string> = new Set<string>([
  'column',
  'labels',
  'priority',
  // 'agent' is legacy/reserved — the assignee concept was removed, but the key
  // stays reserved so a custom field can never claim it.
  'agent',
  'live',
  'status',
  'progress',
  'comments',
  'updatedAt',
  'title',
  'id',
]);

const FIELD_TYPES: ReadonlySet<CustomFieldType> = new Set<CustomFieldType>([
  'text',
  'number',
  'boolean',
  'date',
  'select',
  'multiselect',
]);

export const DEFAULT_LABELS: Record<string, LabelDef> = {
  backend: { name: 'backend', color: '#3fb27f' },
  frontend: { name: 'frontend', color: '#4c8bf5' },
  bug: { name: 'bug', color: '#e5534b' },
  infra: { name: 'infra', color: '#d99a30' },
  docs: { name: 'docs', color: '#9a7bd6' },
  perf: { name: 'perf', color: '#c9a227' },
};

/** The 5 default board columns, matching the design mock. */
export function defaultColumns(): ConfigColumn[] {
  return [
    { id: 'backlog', name: 'Backlog', color: '#7d828b' },
    { id: 'todo', name: 'To Do', color: '#4c8bf5' },
    { id: 'doing', name: 'In Progress', color: '#5cd68a', wip: 3 },
    { id: 'review', name: 'In Review', color: '#d99a30' },
    { id: 'done', name: 'Done', color: '#3fb27f' },
  ];
}

/**
 * Coerces arbitrary parsed JSON into a {@link BoardConfig}. Missing or malformed
 * input falls back to a board named after `boardId` with no columns and an empty
 * label map. Column entries without a string `id` are dropped, and label entries
 * that are null, non-objects, or carry no usable string fields are dropped too —
 * so a stray `"labels": { "bug": null }` never reaches the UI.
 */
export function normalizeBoardConfig(parsed: unknown, boardId: string): BoardConfig {
  const fallbackName = titleCase(boardId);
  if (!parsed || typeof parsed !== 'object') {
    return { name: fallbackName, columns: [], labels: {}, fields: [] };
  }
  const p = parsed as Record<string, unknown>;
  return {
    name:
      typeof p.name === 'string' && p.name.trim() ? p.name : fallbackName,
    columns: Array.isArray(p.columns)
      ? (p.columns as unknown[])
          .map(normalizeColumn)
          .filter((c): c is ConfigColumn => c !== undefined)
      : [],
    labels: cleanDefMap<LabelDef>(p.labels),
    fields: normalizeFields(p.fields),
  };
}

/**
 * Coerces one raw column entry into a {@link ConfigColumn}, dropping entries
 * without a usable string id and normalizing any `enter`/`exit` gate lists.
 * Empty gate lists are omitted so untouched configs round-trip unchanged.
 */
function normalizeColumn(raw: unknown): ConfigColumn | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  const c = raw as Record<string, unknown>;
  if (typeof c.id !== 'string' || c.id.length === 0) {
    return undefined;
  }
  const out: ConfigColumn = {
    id: c.id,
    name: typeof c.name === 'string' ? c.name : '',
    color: typeof c.color === 'string' ? c.color : '',
  };
  if (typeof c.wip === 'number' && Number.isFinite(c.wip)) {
    out.wip = c.wip;
  }
  const enter = normalizeGates(c.enter);
  if (enter.length) {
    out.enter = enter;
  }
  const exit = normalizeGates(c.exit);
  if (exit.length) {
    out.exit = exit;
  }
  return out;
}

/**
 * Validates the board's custom `fields`. Drops entries that are not objects,
 * lack a string id, collide with a {@link RESERVED_CARD_KEYS reserved key},
 * duplicate an earlier field id, or carry an unknown `type`. `select` and
 * `multiselect` always get an `options` string array (defaulting to `[]`).
 */
function normalizeFields(value: unknown): CustomFieldDef[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: CustomFieldDef[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      continue;
    }
    const f = raw as Record<string, unknown>;
    const id = f.id;
    if (typeof id !== 'string' || id.length === 0) {
      continue;
    }
    if (RESERVED_CARD_KEYS.has(id) || seen.has(id)) {
      continue;
    }
    const type = f.type;
    if (typeof type !== 'string' || !FIELD_TYPES.has(type as CustomFieldType)) {
      continue;
    }
    const def: CustomFieldDef = { id, type: type as CustomFieldType };
    if (typeof f.label === 'string') {
      def.label = f.label;
    }
    if (typeof f.showOnCard === 'boolean') {
      def.showOnCard = f.showOnCard;
    }
    if (type === 'select' || type === 'multiselect') {
      def.options = Array.isArray(f.options)
        ? f.options.filter((o): o is string => typeof o === 'string')
        : [];
    }
    out.push(def);
    seen.add(id);
  }
  return out;
}

/**
 * Validates a per-column `enter`/`exit` gate list, keeping only
 * `{id, label?, script?, field?, check?}`. Drops non-objects and entries
 * without a string id or without at least one of `script` / `field`. When both
 * `script` and `field` are present, `script` wins (the entry becomes a script
 * gate and `field`/`check` are dropped). `check` is kept only on a field gate.
 */
function normalizeGates(value: unknown): GateDef[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: GateDef[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      continue;
    }
    const g = raw as Record<string, unknown>;
    const id = g.id;
    if (typeof id !== 'string' || id.length === 0) {
      continue;
    }
    const script = typeof g.script === 'string' ? g.script : undefined;
    const field = typeof g.field === 'string' ? g.field : undefined;
    if (script === undefined && field === undefined) {
      continue; // a gate is script XOR field — an entry with neither is dropped
    }
    const def: GateDef = { id };
    if (typeof g.label === 'string') {
      def.label = g.label;
    }
    if (script !== undefined) {
      def.script = script; // precedence: when both are set, keep only script
    } else {
      def.field = field;
      if (typeof g.check === 'string') {
        def.check = g.check; // check is meaningful only for a field gate
      }
    }
    out.push(def);
  }
  return out;
}

/**
 * Keeps only map entries whose value is a non-null object carrying at least one
 * usable string field; drops nulls, arrays, primitives, and empty shells.
 */
function cleanDefMap<T>(value: unknown): Record<string, T> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const out: Record<string, T> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (
      entry &&
      typeof entry === 'object' &&
      !Array.isArray(entry) &&
      Object.values(entry as Record<string, unknown>).some((v) => typeof v === 'string')
    ) {
      out[key] = entry as T;
    }
  }
  return out;
}
