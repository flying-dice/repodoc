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

import {
  type BoardConfig,
  DEFAULT_COLUMN_COLOR,
  readBoardConfigFile,
  toColumns,
} from './boardConfig';
import { detectEol } from './eol';
import {
  addScenario,
  type NewScenario,
  removeScenario,
  type ScenarioPatch,
  setFeatureDescription,
  setFeatureTitle,
  setScenario,
} from './featureBody';
import {
  featureIdFromFileName,
  featureTagRegionEnd,
  parseFeature,
  STATUS_TAG_PREFIX,
  statusFromTags,
  tagsWithoutStatus,
} from './featureParse';
import { slugify, titleCase, uniqueSlug } from './naming';
import type { FileSystemPort } from './ports';
import type {
  AddCardResult,
  BoardData,
  Card,
  FeatureRecord,
  FeatureSetRef,
  MoveCardResult,
  RepoDocConfig,
} from './types';

/**
 * The feature metadata a managed edit may change. A feature has no frontmatter:
 * the title IS the `Feature:` line and the description IS the free text under
 * it, so this is the whole of it. An absent key is left alone; an empty
 * `description` removes the description.
 */
export interface FeatureMetaPatch {
  title?: string;
  description?: string;
}

/** The default columns of a new feature set — a specification pipeline. */
export function defaultFeatureColumns(): BoardConfig['columns'] {
  return [
    { id: 'proposed', name: 'Proposed', color: DEFAULT_COLUMN_COLOR },
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
    // Gates are not enforced for feature sets (Decision 10), so they are not
    // shown either: drop enter/exit from the projection.
    const columns = toColumns(config).map(({ enter: _enter, exit: _exit, ...column }) => column);
    const byId = new Map(columns.map((c) => [c.id, c]));

    // Null prototype: a card id like `constructor` must never resolve to Object.prototype.
    const cards: Record<string, Card> = Object.create(null) as Record<string, Card>;
    for (const record of this.list(setId)) {
      if (cards[record.id] !== undefined) {
        // Two files map to the same id — the first in file-name order keeps it,
        // so an id never appears twice on the board.
        continue;
      }
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

  /**
   * Writes a new set config and returns its id. Does not fire events. The id is
   * unique among the existing set directories, compared case-insensitively:
   * `features/Login/` and `features/login/` are one directory on macOS and
   * Windows, where the second config would silently replace the first.
   */
  createSet(name: string): string {
    const id = uniqueSlug(slugify(name), new Set(this.setDirNames()));
    const config: BoardConfig = {
      name: name.trim() || titleCase(id),
      columns: defaultFeatureColumns(),
      labels: {},
      fields: [],
    };
    this.fs.writeFile(this.configFilePath(id), `${JSON.stringify(config, null, 2)}\n`);
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
    const slug = uniqueSlug(slugify(title, 'feature'), taken);
    // The title becomes the `Feature:` line; a newline in it would forge Gherkin
    // structure, so whitespace is collapsed as it is for a card title.
    this.fs.writeFile(
      `features/${setId}/${slug}.feature`,
      `${STATUS_TAG_PREFIX}${column}\nFeature: ${title.replace(/\s+/g, ' ').trim()}\n`,
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

  /**
   * Rewrites a feature's title (the `Feature:` line) and/or its description
   * (the free text under it). Every other byte of the file — its tags, its
   * scenarios, its `Rule:` and `Background:` blocks, its comments and its line
   * endings — is preserved. Returns whether it was written: an unknown set or
   * feature, an unreadable file, or a blank title, writes nothing.
   *
   * A description needs a `Feature:` line to hang off, so describing a file
   * that has none is refused rather than written somewhere it would not be read
   * back from. (A patch that also carries a title is fine: the title inserts
   * the line first.)
   */
  updateFeatureMeta(setId: string, featureId: string, patch: FeatureMetaPatch): boolean {
    const title = patch.title === undefined ? undefined : oneLine(patch.title);
    if (patch.title !== undefined && title === '') {
      return false; // a feature must keep a name; an empty Feature: line has none
    }
    return this.editFeatureFile(setId, featureId, (text) => {
      let next = text;
      if (title !== undefined) {
        next = setFeatureTitle(next, title);
      }
      if (patch.description !== undefined) {
        if (parseFeature(featureId, next).featureLine === undefined) {
          return undefined; // nothing to hang a description off — write nothing
        }
        next = setFeatureDescription(next, patch.description);
      }
      return next;
    });
  }

  /**
   * Rewrites the scenario at `index` (as counted by {@link parseFeature} —
   * `Rule:` and `Background:` blocks are not scenarios and cannot be reached).
   * Its keyword, its tag lines and every other scenario are preserved. Returns
   * whether it was written: an unknown feature, an out-of-range index, or a
   * blank name, writes nothing.
   */
  setFeatureScenario(
    setId: string,
    featureId: string,
    index: number,
    patch: ScenarioPatch,
  ): boolean {
    const name = patch.name === undefined ? undefined : oneLine(patch.name);
    if (patch.name !== undefined && name === '') {
      return false; // a nameless scenario cannot be told apart on the board
    }
    if (!Number.isInteger(index) || index < 0) {
      return false;
    }
    return this.editFeatureFile(setId, featureId, (text) =>
      setScenario(text, index, { ...patch, ...(name === undefined ? {} : { name }) }),
    );
  }

  /** Appends a scenario at the end of the file. False for a blank name. */
  addFeatureScenario(setId: string, featureId: string, scenario: NewScenario): boolean {
    const name = oneLine(scenario.name);
    if (name === '') {
      return false;
    }
    return this.editFeatureFile(setId, featureId, (text) =>
      addScenario(text, { ...scenario, name }),
    );
  }

  /** Removes the scenario at `index`, its tags with it. False when out of range. */
  removeFeatureScenario(setId: string, featureId: string, index: number): boolean {
    if (!Number.isInteger(index) || index < 0) {
      return false;
    }
    return this.editFeatureFile(setId, featureId, (text) => removeScenario(text, index));
  }

  /**
   * Read-modify-write one `.feature` file: resolves the feature's path, applies
   * `edit`, and writes the result. Returns whether a write happened — an
   * unknown set or feature, an unreadable file, or an `edit` that declined
   * (an out-of-range scenario index) leaves the file untouched. Every managed
   * feature edit goes through here so "resolve, write" exists once; firing is
   * the store's job, as it is for `move`.
   */
  private editFeatureFile(
    setId: string,
    featureId: string,
    edit: (text: string) => string | undefined,
  ): boolean {
    if (!this.fs.exists(`features/${setId}`)) {
      return false;
    }
    const path = this.filePath(setId, featureId);
    if (path === undefined) {
      return false;
    }
    const content = this.fs.readFile(path);
    if (content === undefined) {
      return false;
    }
    const next = edit(content);
    if (next === undefined) {
      return false;
    }
    this.fs.writeFile(path, next);
    return true;
  }

  /** Path of a set's `.config.json` relative to the workspace root. */
  configFilePath(setId: string): string {
    return `features/${setId}/.config.json`;
  }

  /** Path of a feature file relative to the workspace root. */
  filePath(setId: string, featureId: string): string | undefined {
    const fileName = this.featureFileNames(setId).find(
      (name) => featureIdFromFileName(name) === featureId,
    );
    return fileName ? `features/${setId}/${fileName}` : undefined;
  }

  /** Every `features/<id>/` directory name, ignoring dot-directories. */
  private setDirNames(): string[] {
    return this.fs
      .listDir('features')
      .filter((e) => e.kind === 'dir' && !e.name.startsWith('.'))
      .map((e) => e.name);
  }

  private featureFileNames(setId: string): string[] {
    return this.fs
      .listDir(`features/${setId}`)
      .filter((e) => e.kind === 'file' && !e.name.startsWith('.') && /\.feature$/i.test(e.name))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b));
  }

  private readConfig(setId: string): BoardConfig {
    return readBoardConfigFile(this.fs, this.configFilePath(setId), setId);
  }
}

/**
 * A title or scenario name as ONE line, as the writers demand: a newline in it
 * would forge Gherkin structure (a second `Feature:`, a `@status:` tag, a step).
 */
function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
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
    scenarios: parsed.scenarios.map((s) => ({
      name: s.name,
      tags: s.tags,
      keyword: s.keyword,
      steps: s.steps,
    })),
  };
}

/**
 * A feature as a board card: its non-status tags are the labels, its
 * description is the feature's free text, and its scenarios ride along as
 * structured data.
 *
 * The scenarios used to be appended to `desc` as a `## Scenarios` markdown
 * list. They are not any more: the description is EDITABLE now, and an editor
 * that showed that list would write it back into the `Feature:` free text as
 * prose — duplicating every scenario and losing its steps. Features carry no
 * checklist, comments, gates, or custom fields.
 */
function toCard(record: FeatureRecord): Card {
  const card: Card = { id: record.id, title: record.title };
  if (record.tags.length) {
    card.labels = record.tags;
  }
  if (record.description) {
    card.desc = record.description;
  }
  if (record.scenarios.length) {
    card.scenarios = record.scenarios;
  }
  return card;
}

/**
 * Rewrites the feature-level `@status:` tag to `columnId`. An existing tag
 * token is replaced where it stands; when there is none, a tag line is inserted
 * immediately above the `Feature:` line (or at the top of a file that has no
 * `Feature:` line). Pure — every other byte is preserved.
 *
 * Only the file's OWN tag region is considered — {@link featureTagRegionEnd},
 * the region {@link parseFeature} reads the feature's tags from. A `@status:`
 * tag below it belongs to a scenario, and rewriting one there would move a
 * feature the board never showed in that column.
 */
export function writeStatusTag(content: string, columnId: string): string {
  const lines = content.split('\n');
  const featureIdx = lines.findIndex((l) => /^\s*Feature:/.test(l));
  const end = featureTagRegionEnd(lines);
  for (let i = 0; i < end; i++) {
    const line = lines[i];
    if (line === undefined || !/^\s*@/.test(line) || !line.includes(STATUS_TAG_PREFIX)) {
      continue;
    }
    lines[i] = line.replace(/@status:\S*/, `${STATUS_TAG_PREFIX}${columnId}`);
    return lines.join('\n');
  }
  // A line INSERTED into a CRLF file must end like its neighbours, or the file
  // comes back with mixed endings; replacing a tag in place needs no such care.
  const eol = detectEol(content);
  const tag = `${STATUS_TAG_PREFIX}${columnId}`;
  lines.splice(Math.max(0, featureIdx), 0, eol === '\r\n' ? `${tag}\r` : tag);
  return lines.join('\n');
}
