/**
 * Feature-set storage: folders of Gherkin `.feature` files that render on the
 * same kanban surface as a board.
 *
 *  - `features/<set-id>/.config.json` — the SAME shape as a board config
 *    (`name`, `columns`, `labels`, `fields`), normalized by
 *    {@link normalizeBoardConfig}.
 *  - `features/<set-id>/<slug>.feature` — one feature per file, its column
 *    carried by a `@status:<columnId>` tag on the Feature's tag line.
 *
 * NOTE: column `enter`/`exit` gates may be present in a feature set's config
 * but are NOT enforced for features in this iteration — {@link FeatureStore.move}
 * never evaluates them. Feature files are also never renamed or renumbered by a
 * move: test runners reference them by path.
 *
 * The store delegates its feature methods here, exactly as it does for
 * decisions and docs.
 */

import { type BoardConfig, normalizeBoardConfig } from './boardConfig';
import {
  featureIdFromFileName,
  parseFeature,
  STATUS_TAG_PREFIX,
  statusFromTags,
  tagsWithoutStatus,
} from './featureParse';
import { slugify, titleCase } from './naming';
import type { FileSystemPort } from './ports';
import type { AddCardResult, MoveCardResult } from './store';
import type { BoardData, Card, Column, FeatureRecord, FeatureSetRef, RepoDocConfig } from './types';

/** The default columns of a new feature set — a specification pipeline. */
export function defaultFeatureColumns(): BoardConfig['columns'] {
  return [
    { id: 'proposed', name: 'Proposed', color: '#7d828b' },
    { id: 'specified', name: 'Specified', color: '#4c8bf5' },
    { id: 'implemented', name: 'Implemented', color: '#5cd68a' },
    { id: 'verified', name: 'Verified', color: '#3fb27f' },
  ];
}

export class FeatureStore {
  constructor(private readonly fs: FileSystemPort) {}

  /** Every `features/<set-id>/` directory, sorted by display name. */
  listSets(): FeatureSetRef[] {
    const refs: FeatureSetRef[] = [];
    for (const entry of this.fs.listDir('features')) {
      if (entry.kind !== 'dir' || entry.name.startsWith('.')) {
        continue;
      }
      refs.push({
        id: entry.name,
        name: this.readConfig(entry.name).name,
        featureCount: this.featureFileNames(entry.name).length,
      });
    }
    refs.sort((a, b) => a.name.localeCompare(b.name));
    return refs;
  }

  /** The set's labels and fields, in the shape the board webview expects. */
  config(setId: string): RepoDocConfig {
    const config = this.readConfig(setId);
    return { labels: config.labels, fields: config.fields };
  }

  displayPath(setId: string): string {
    return `features/${setId}/`;
  }

  /**
   * The set rendered as board data: columns from the config, one card per
   * feature. A feature whose `@status:` tag is missing or names an unknown
   * column falls into the first column so nothing is ever invisible.
   */
  board(setId: string): BoardData | undefined {
    if (!this.fs.exists(`features/${setId}`)) {
      return undefined;
    }
    const config = this.readConfig(setId);
    const columns: Column[] = config.columns.map((c) => {
      const column: Column = {
        id: c.id,
        name: c.name || titleCase(c.id),
        color: c.color || '#7d828b',
        cardIds: [],
      };
      if (c.wip !== undefined) {
        column.wip = c.wip;
      }
      if (c.prompt !== undefined) {
        column.prompt = c.prompt;
      }
      return column;
    });
    const byId = new Map(columns.map((c) => [c.id, c]));

    const cards: Record<string, Card> = {};
    for (const record of this.list(setId)) {
      cards[record.id] = toCard(record);
      const column = byId.get(record.status) ?? (columns.length > 0 ? columns[0] : undefined);
      column?.cardIds.push(record.id);
    }
    return { name: config.name, columns, cards };
  }

  /** Every feature in the set, in file-name order. */
  list(setId: string): FeatureRecord[] {
    const columnIds = this.readConfig(setId).columns.map((c) => c.id);
    const firstColumn = columnIds[0] ?? '';
    const records: FeatureRecord[] = [];
    for (const fileName of this.featureFileNames(setId)) {
      const content = this.fs.readFile(`features/${setId}/${fileName}`);
      if (content === undefined) {
        continue; // unreadable — skip
      }
      records.push(toRecord(fileName, content, firstColumn, columnIds));
    }
    return records;
  }

  get(setId: string, featureId: string): FeatureRecord | undefined {
    return this.list(setId).find((f) => f.id === featureId);
  }

  /** Writes a new set config and returns its id. Does not fire events. */
  createSet(name: string): string {
    const id = slugify(name);
    const config: BoardConfig = {
      name: name.trim() || titleCase(id),
      columns: defaultFeatureColumns(),
      labels: {},
      fields: [],
    };
    this.fs.writeFile(`features/${id}/.config.json`, `${JSON.stringify(config, null, 2)}\n`);
    return id;
  }

  /**
   * Creates `<slug>.feature` holding a `@status:` tag and a `Feature:` line.
   * A slug already in the set gets a `-2` / `-3` suffix, as cards do.
   */
  create(setId: string, title: string, columnId?: string): AddCardResult {
    if (!this.fs.exists(`features/${setId}`)) {
      return { ok: false, error: { code: 'unknown-board', boardId: setId } };
    }
    const columns = this.readConfig(setId).columns;
    const column = columnId ?? columns[0]?.id;
    if (column === undefined || !columns.some((c) => c.id === column)) {
      return { ok: false, error: { code: 'unknown-column', columnId: columnId ?? '' } };
    }
    const taken = new Set(this.featureFileNames(setId).map(featureIdFromFileName));
    const base = slugify(title, 'feature');
    let slug = base;
    let suffix = 2;
    while (taken.has(slug)) {
      slug = `${base}-${suffix}`;
      suffix++;
    }
    this.fs.writeFile(
      `features/${setId}/${slug}.feature`,
      `${STATUS_TAG_PREFIX}${column}\nFeature: ${title.trim()}\n`,
    );
    return { ok: true, cardId: slug };
  }

  /**
   * Moves a feature by rewriting ONLY its `@status:` tag — an existing tag is
   * replaced in place, otherwise a tag line is inserted immediately above the
   * `Feature:` line. Every other byte of the file is preserved and the file is
   * never renamed. Gates are not evaluated (see the module note).
   */
  move(setId: string, featureId: string, columnId: string): MoveCardResult {
    if (!this.fs.exists(`features/${setId}`)) {
      return { ok: false, error: { code: 'unknown-board', boardId: setId } };
    }
    const fileName = this.featureFileNames(setId).find(
      (name) => featureIdFromFileName(name) === featureId,
    );
    if (!fileName) {
      return { ok: false, error: { code: 'unknown-card', cardId: featureId } };
    }
    if (!this.readConfig(setId).columns.some((c) => c.id === columnId)) {
      return { ok: false, error: { code: 'unknown-column', columnId } };
    }
    const path = `features/${setId}/${fileName}`;
    const content = this.fs.readFile(path);
    if (content === undefined) {
      return { ok: false, error: { code: 'unreadable-card', cardId: featureId } };
    }
    this.fs.writeFile(path, writeStatusTag(content, columnId));
    return { ok: true };
  }

  /** Path of a feature file relative to the workspace root. */
  filePath(setId: string, featureId: string): string | undefined {
    const fileName = this.featureFileNames(setId).find(
      (name) => featureIdFromFileName(name) === featureId,
    );
    return fileName ? `features/${setId}/${fileName}` : undefined;
  }

  private featureFileNames(setId: string): string[] {
    return this.fs
      .listDir(`features/${setId}`)
      .filter((e) => e.kind === 'file' && !e.name.startsWith('.') && /\.feature$/i.test(e.name))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b));
  }

  private readConfig(setId: string): BoardConfig {
    const raw = this.fs.readFile(`features/${setId}/.config.json`);
    if (raw === undefined) {
      return normalizeBoardConfig(undefined, setId);
    }
    try {
      return normalizeBoardConfig(JSON.parse(raw), setId);
    } catch {
      return normalizeBoardConfig(undefined, setId);
    }
  }
}

/** Builds a {@link FeatureRecord}, resolving the status tag against `columnIds`. */
function toRecord(
  fileName: string,
  content: string,
  firstColumn: string,
  columnIds: string[],
): FeatureRecord {
  const parsed = parseFeature(fileName, content);
  const tagged = statusFromTags(parsed.tags);
  const status = tagged !== undefined && columnIds.includes(tagged) ? tagged : firstColumn;
  return {
    id: featureIdFromFileName(fileName),
    file: fileName,
    title: parsed.title,
    description: parsed.description,
    tags: tagsWithoutStatus(parsed.tags),
    status,
    scenarios: parsed.scenarios.map((s) => ({ name: s.name, tags: s.tags })),
  };
}

/**
 * A feature as a board card: its non-status tags are the labels and its
 * description is followed by a `## Scenarios` list. Features carry no
 * checklist, comments, gates, or custom fields.
 */
function toCard(record: FeatureRecord): Card {
  const card: Card = { id: record.id, title: record.title };
  if (record.tags.length) {
    card.labels = record.tags;
  }
  const blocks: string[] = [];
  if (record.description) {
    blocks.push(record.description);
  }
  if (record.scenarios.length) {
    blocks.push(['## Scenarios', '', ...record.scenarios.map((s) => `- ${s.name}`)].join('\n'));
  }
  if (blocks.length) {
    card.desc = blocks.join('\n\n');
  }
  return card;
}

/**
 * Rewrites the feature-level `@status:` tag to `columnId`. An existing tag
 * token is replaced where it stands; when there is none, a tag line is inserted
 * immediately above the `Feature:` line (or at the top of a file that has no
 * `Feature:` line). Pure — every other byte is preserved.
 */
export function writeStatusTag(content: string, columnId: string): string {
  const lines = content.split('\n');
  const featureIdx = lines.findIndex((l) => /^\s*Feature:/.test(l));
  const end = featureIdx === -1 ? lines.length : featureIdx;
  for (let i = 0; i < end; i++) {
    const line = lines[i];
    if (line === undefined || !/^\s*@/.test(line) || !line.includes(STATUS_TAG_PREFIX)) {
      continue;
    }
    lines[i] = line.replace(/@status:\S*/, `${STATUS_TAG_PREFIX}${columnId}`);
    return lines.join('\n');
  }
  lines.splice(Math.max(0, featureIdx), 0, `${STATUS_TAG_PREFIX}${columnId}`);
  return lines.join('\n');
}
