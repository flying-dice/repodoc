import {
  type BoardConfig,
  DEFAULT_COLUMN_COLOR,
  DEFAULT_LABELS,
  defaultColumns,
  readBoardConfigFile,
  toColumns,
} from './boardConfig';
import {
  appendChecklistLine,
  appendCommentLine,
  replaceDescription,
  replaceTitle,
  upsertGateLine,
} from './cardBody';
import { type CardEntry, findChecklist, parseCard } from './cardParse';
import { DecisionStore } from './decisions';
import { DocStore } from './docs';
import { FeatureStore } from './features';
import { parseFrontmatter, serializeFrontmatter } from './frontmatter';
import { evaluateTransition } from './gates';
import { pad, slugFromFileName, slugify, titleCase, uniqueSlug } from './naming';
import { computeCardOrder } from './ordering';
import type { ClockPort, Disposable, FileSystemPort } from './ports';
import { formatRef } from './refs';
import { seedBoardConfig } from './seed';
import type {
  AddCardResult,
  BoardData,
  BoardRef,
  Card,
  CustomFieldDef,
  CustomFieldValue,
  DecisionRecord,
  DocNode,
  FeatureRecord,
  FeatureSetRef,
  GateResult,
  MoveCardResult,
  Priority,
  RepoDocConfig,
} from './types';

/**
 * The reserved, host-editable card metadata. `undefined` leaves a key alone;
 * `null` removes it from the frontmatter.
 */
export interface CardMetaPatch {
  title?: string;
  labels?: string[] | null;
  priority?: Priority | null;
  agent?: string | null;
  live?: boolean | null;
  status?: string | null;
  progress?: number | null;
}

/**
 * RepoDoc's data store, built on the new on-disk layout. It talks to the
 * filesystem and the clock only through ports, so it never imports 'vscode'
 * and stays unit-testable against an in-memory adapter.
 *
 * Board logic lives here; decisions, docs, and feature sets are delegated to
 * the dedicated stores in `decisions.ts` / `docs.ts` / `features.ts`, keeping
 * each domain focused.
 */
export class RepoDocStore {
  /** Absolute workspace path — metadata only (e.g. for the host's openFile). */
  readonly root: string | undefined;

  private readonly listeners: Array<() => void> = [];
  private readonly decisions: DecisionStore;
  private readonly docs: DocStore;
  private readonly features: FeatureStore;

  constructor(
    private readonly fs: FileSystemPort,
    private readonly clock: ClockPort,
    root?: string,
  ) {
    this.root = root;
    this.decisions = new DecisionStore(fs);
    this.docs = new DocStore(fs);
    this.features = new FeatureStore(fs);
  }

  // ---- change notification ----

  onDidChange(listener: () => void): Disposable {
    this.listeners.push(listener);
    return {
      dispose: (): void => {
        const i = this.listeners.indexOf(listener);
        if (i >= 0) {
          this.listeners.splice(i, 1);
        }
      },
    };
  }

  /** Re-fires listeners; called by the host's file watchers on external edits. */
  notifyExternalChange(): void {
    this.fire();
  }

  private fire(): void {
    for (const listener of [...this.listeners]) {
      listener();
    }
  }

  // ---- lifecycle ----

  isInitialized(): boolean {
    return this.fs.exists('boards') || this.fs.exists('decisions') || this.fs.exists('features');
  }

  /**
   * Bootstrap: writes ONLY the starter board config when it is absent — never
   * seed cards, decisions, or docs. Initializing on an existing repo must never
   * risk touching user content. Idempotent: a second init leaves everything as
   * is. Always fires so listeners refresh.
   */
  init(): void {
    const boardConfig = this.configPath('project-backlog');
    if (!this.fs.exists(boardConfig)) {
      this.fs.writeFile(boardConfig, jsonFileContent(seedBoardConfig()));
    }
    this.fire();
  }

  // ---- config ----

  getBoardConfig(boardId: string): RepoDocConfig {
    const config = this.readConfig(boardId);
    return { labels: config.labels, fields: config.fields };
  }

  displayPath(boardId: string): string {
    return `boards/${boardId}/`;
  }

  /** Path of a board's `.config.json` relative to the root, for hosts that open it. */
  configFilePath(boardId: string): string {
    return this.configPath(boardId);
  }

  /** Path of a feature set's `.config.json` relative to the root. */
  featureSetConfigFilePath(setId: string): string {
    return this.features.configFilePath(setId);
  }

  /** Path of a decision file relative to the root; undefined for an unknown id. */
  decisionFilePath(id: string): string | undefined {
    const record = this.decisions.get(id);
    return record ? `decisions/${record.file}` : undefined;
  }

  private configPath(boardId: string): string {
    return `boards/${boardId}/.config.json`;
  }

  /** Writes a board config and notifies listeners. */
  private writeConfig(boardId: string, config: BoardConfig): void {
    this.fs.writeFile(this.configPath(boardId), jsonFileContent(config));
    this.fire();
  }

  private readConfig(boardId: string): BoardConfig {
    return readBoardConfigFile(this.fs, this.configPath(boardId), boardId);
  }

  // ---- boards ----

  listBoards(): BoardRef[] {
    const refs: BoardRef[] = [];
    for (const entry of this.fs.listDir('boards')) {
      if (entry.kind !== 'dir' || entry.name.startsWith('.')) {
        continue;
      }
      const config = this.readConfig(entry.name);
      refs.push({
        id: entry.name,
        name: config.name,
        cardCount: this.cardFileNames(entry.name).length,
      });
    }
    refs.sort((a, b) => a.name.localeCompare(b.name));
    return refs;
  }

  getBoard(id: string): BoardData | undefined {
    if (!this.fs.exists(`boards/${id}`)) {
      return undefined;
    }
    const config = this.readConfig(id);
    const columns = toColumns(config);
    const byId = new Map(columns.map((c) => [c.id, c]));

    const cards: Record<string, Card> = {};
    for (const entry of this.readBoardCards(id)) {
      if (cards[entry.slug] !== undefined) {
        // Two files share this id (e.g. 01-foo.md and 02-foo.md). The first in
        // file-name order owns the id; listing the rest would put one id in two
        // places, which hosts key their UI by. Renaming resolves it.
        continue;
      }
      cards[entry.slug] = entry.card;
      // Unknown/missing column falls back to the first column so cards are
      // never invisible.
      const col = byId.get(entry.column) ?? (columns.length > 0 ? columns[0] : undefined);
      if (col) {
        col.cardIds.push(entry.slug);
      }
    }

    return { name: config.name, columns, cards };
  }

  createBoard(name: string): string {
    const id = slugify(name);
    const config: BoardConfig = {
      name: name.trim() || titleCase(id),
      columns: defaultColumns(),
      labels: { ...DEFAULT_LABELS },
      fields: [],
    };
    this.writeConfig(id, config);
    return id;
  }

  addCard(boardId: string, columnId: string, title: string): AddCardResult {
    if (!this.fs.exists(`boards/${boardId}`)) {
      return { ok: false, error: { code: 'unknown-board', boardId } };
    }
    const config = this.readConfig(boardId);
    if (!config.columns.some((c) => c.id === columnId)) {
      return { ok: false, error: { code: 'unknown-column', columnId } };
    }
    const entries = this.readBoardCards(boardId);
    const slug = uniqueSlug(slugify(title, 'card'), new Set(entries.map((e) => e.slug)));
    const maxNum = entries.reduce((max, e) => Math.max(max, e.num ?? 0), 0);
    const num = maxNum + 1;
    const width = Math.max(2, String(num).length);
    const fileName = `${pad(num, width)}-${slug}.md`;

    const data: Record<string, unknown> = { column: columnId, updatedAt: this.now() };
    // The title becomes the body's `# ` heading; a newline in it would forge a
    // section, so it is collapsed exactly as replaceTitle collapses one.
    const body = `# ${title.replace(/\s+/g, ' ').trim()}\n`;
    this.fs.writeFile(`boards/${boardId}/${fileName}`, serializeFrontmatter(data, body));
    this.fire();
    return { ok: true, cardId: slug };
  }

  addColumn(boardId: string, name: string): void {
    const config = this.readConfig(boardId);
    const id = slugify(name);
    config.columns.push({ id, name: name.trim() || titleCase(id), color: DEFAULT_COLUMN_COLOR });
    this.writeConfig(boardId, config);
  }

  /**
   * Moves a card into `toColumnId` at `index` (clamped; pass a large number for
   * "last"). Gates are NOT evaluated here — hosts call {@link evaluateMove}
   * first and decide whether to proceed or record an override.
   */
  moveCard(boardId: string, cardId: string, toColumnId: string, index: number): MoveCardResult {
    if (!this.fs.exists(`boards/${boardId}`)) {
      return { ok: false, error: { code: 'unknown-board', boardId } };
    }
    const entries = this.readBoardCards(boardId);
    const moved = entries.find((e) => e.slug === cardId);
    if (!moved) {
      return { ok: false, error: { code: 'unknown-card', cardId } }; // never delete
    }
    // Slugs are card identities. Externally-authored files can collide (two
    // NN-foo.md files); renumbering would then rename one file over the other
    // and destroy it, so refuse to reorder until the collision is resolved.
    const seen = new Set<string>();
    for (const e of entries) {
      if (seen.has(e.slug)) {
        return { ok: false, error: { code: 'duplicate-slugs', slug: e.slug } };
      }
      seen.add(e.slug);
    }
    const config = this.readConfig(boardId);
    if (!config.columns.some((c) => c.id === toColumnId)) {
      return { ok: false, error: { code: 'unknown-column', columnId: toColumnId } };
    }

    // Set the card's column in its frontmatter (same file name, updatedAt stamped).
    const updated = this.updateCardFile(boardId, moved.fileName, (data, body) => {
      data['column'] = toColumnId;
      return { data, body };
    });
    if (!updated) {
      return { ok: false, error: { code: 'unreadable-card', cardId } };
    }

    // Compute the new global card order, then renumber files to match.
    const newOrder = computeCardOrder(entries, cardId, toColumnId, index);
    const slugToFile = new Map(entries.map((e) => [e.slug, e.fileName]));
    this.renumber(
      boardId,
      newOrder.map((slug) => ({ slug, currentFile: slugToFile.get(slug) as string })),
    );
    this.fire();
    return { ok: true };
  }

  /**
   * Updates the reserved card metadata (title, labels, priority, agent, live,
   * status, progress) in one read-modify-write. The title is the body's first
   * `# ` heading, which is rewritten in place (or inserted when missing).
   * Returns whether the card exists; an empty patch still stamps `updatedAt`.
   *
   * Every written scalar is collapsed to one line: frontmatter is `key: value`
   * per line, so a value carrying a newline could otherwise forge another key
   * (e.g. a status of "busy\ncolumn: done" would move the card).
   */
  updateCardMeta(boardId: string, cardId: string, patch: CardMetaPatch): boolean {
    return this.updateCard(boardId, cardId, (data, body) => {
      applyMetaKey(data, 'labels', patch.labels?.map(oneLine) ?? patch.labels);
      applyMetaKey(data, 'priority', patch.priority);
      applyMetaKey(data, 'agent', oneLineOrKeep(patch.agent));
      applyMetaKey(data, 'live', patch.live);
      applyMetaKey(data, 'status', oneLineOrKeep(patch.status));
      applyMetaKey(data, 'progress', patch.progress);
      const nextBody = patch.title === undefined ? body : replaceTitle(body, patch.title);
      return { data, body: nextBody };
    });
  }

  toggleChecklistItem(boardId: string, cardId: string, itemIndex: number): void {
    this.updateCard(boardId, cardId, (data, body) => {
      const { indices } = findChecklist(body);
      if (itemIndex < 0 || itemIndex >= indices.length) {
        return undefined; // out of range — leave the file untouched
      }
      const bodyLines = body.split('\n');
      const li = indices[itemIndex];
      const target = li === undefined ? undefined : bodyLines[li];
      if (li === undefined || target === undefined) {
        return undefined; // index out of range — leave the file untouched
      }
      bodyLines[li] = target.replace(/\[([ xX])\]/, (_m: string, c: string) =>
        c.toLowerCase() === 'x' ? '[ ]' : '[x]',
      );
      return { data, body: bodyLines.join('\n') };
    });
  }

  /**
   * Appends `- [ ] <text>` to the card's `## Checklist` section, after its last
   * non-blank line. When the section is absent, one is created after the
   * description and before any `## Gates` / `## Comments` section (RepoDoc's
   * mandated section order is Checklist, Gates, Comments). A `text` with
   * newlines is collapsed to a single line. Stamps `updatedAt` and fires.
   * Returns whether the card exists.
   */
  addChecklistItem(boardId: string, cardId: string, text: string): boolean {
    return this.updateCard(boardId, cardId, (data, body) => ({
      data,
      body: appendChecklistLine(body, text),
    }));
  }

  /**
   * Replaces the card's description — the body text between the `# ` title
   * line and the first `## ` heading (or end of body) — with `text` (trimmed,
   * surrounded by a single blank line on each side). A body with no `# `
   * heading gets the description treated as the top of the body. Empty `text`
   * removes the description. All other bytes are preserved. Stamps
   * `updatedAt` and fires. Returns whether the card exists.
   */
  setCardDescription(boardId: string, cardId: string, text: string): boolean {
    return this.updateCard(boardId, cardId, (data, body) => ({
      data,
      body: replaceDescription(body, text),
    }));
  }

  // ---- custom fields ----

  /**
   * Sets (or clears) a board-defined custom field on a card. `fieldId` must be
   * a declared field and `value` must match its type — a wrong type, or an
   * unknown field, is a silent no-op. Passing `undefined` (or an empty array
   * for a multiselect) removes the frontmatter key.
   */
  setCardField(
    boardId: string,
    cardId: string,
    fieldId: string,
    value: CustomFieldValue | undefined,
  ): void {
    const def = this.readConfig(boardId).fields.find((f) => f.id === fieldId);
    if (!def) {
      return; // not a declared field
    }
    let write: CustomFieldValue | undefined;
    if (value !== undefined) {
      const coerced = coerceFieldValue(def, value);
      if (!coerced) {
        return; // wrong type — no-op
      }
      write = coerced.value; // may be undefined for an empty multiselect
    }
    this.updateCard(boardId, cardId, (data, body) => {
      if (write === undefined) {
        delete data[fieldId];
      } else {
        data[fieldId] = write;
      }
      return { data, body };
    });
  }

  // ---- comments ----

  /**
   * Appends a journal entry to a card's `## Comments` section as
   * `- **<who>** (<ISO now>): <text>`. Multi-line text is written with its
   * continuation lines indented two spaces. When the card has no `## Comments`
   * section one is created at the end of the body (after any `## Gates`).
   * Stamps `updatedAt` and fires; an unknown card is a silent no-op.
   */
  addComment(boardId: string, cardId: string, who: string, text: string): void {
    const at = this.now();
    this.updateCard(boardId, cardId, (data, body) => ({
      data,
      body: appendCommentLine(body, who, at, text),
    }));
  }

  // ---- gates ----

  /**
   * Evaluates the gates guarding a move of `cardId` into `toColumnId`. Returns
   * the results of the source column's exit gates plus the target's enter gates.
   * Empty when the card/column is unknown or the move stays in the same column.
   */
  evaluateMove(boardId: string, cardId: string, toColumnId: string): GateResult[] {
    const board = this.getBoard(boardId);
    if (!board) {
      return [];
    }
    const card = board.cards[cardId];
    const to = board.columns.find((c) => c.id === toColumnId);
    if (!card || !to) {
      return [];
    }
    const entry = this.readBoardCards(boardId).find((e) => e.slug === cardId);
    const from = entry ? board.columns.find((c) => c.id === entry.column) : undefined;
    return evaluateTransition(card, from, to);
  }

  /**
   * Records a manual override for `gateId` on a card's `## Gates` section, as
   * `OVERRIDDEN (<who>, <ISO now>)` with `: <reason>` appended when given.
   */
  recordGateOverride(
    boardId: string,
    cardId: string,
    gateId: string,
    who: string,
    reason?: string,
  ): boolean {
    const why = reason?.trim() ? `: ${reason.trim()}` : '';
    return this.recordGate(boardId, cardId, gateId, `OVERRIDDEN (${who}, ${this.now()})${why}`);
  }

  /**
   * Records evidence that a script gate passed, as
   * `- [x] <gateId> — <result> (<who>, <ISO now>)`. Callers must only record a
   * run that actually exited green. Returns whether the card exists.
   */
  recordGateEvidence(
    boardId: string,
    cardId: string,
    gateId: string,
    result: string,
    who: string,
  ): boolean {
    return this.recordGate(boardId, cardId, gateId, `${result} (${who}, ${this.now()})`);
  }

  private recordGate(boardId: string, cardId: string, gateId: string, note: string): boolean {
    return this.updateCard(boardId, cardId, (data, body) => ({
      data,
      body: upsertGateLine(body, gateId, note),
    }));
  }

  // ---- card file helpers ----

  /** The pasteable reference for a card (see {@link formatRef}); undefined for an unknown card. */
  cardRef(boardId: string, cardId: string): string | undefined {
    const card = this.getBoard(boardId)?.cards[cardId];
    if (!card) {
      return undefined;
    }
    return formatRef(boardId, cardId, card.title, this.cardFilePath(boardId, cardId));
  }

  /** The pasteable reference for a feature; undefined for an unknown feature. */
  featureRef(setId: string, featureId: string): string | undefined {
    const feature = this.getFeature(setId, featureId);
    if (!feature) {
      return undefined;
    }
    return formatRef(setId, featureId, feature.title, this.featureFilePath(setId, featureId));
  }

  /** Path of a card file relative to the root (`boards/<id>/NN-slug.md`), for hosts that open it. */
  cardFilePath(boardId: string, cardId: string): string | undefined {
    const fileName = this.cardFileNames(boardId).find((n) => slugFromFileName(n) === cardId);
    return fileName ? `boards/${boardId}/${fileName}` : undefined;
  }

  private cardFileNames(boardId: string): string[] {
    return this.fs
      .listDir(`boards/${boardId}`)
      .filter((e) => e.kind === 'file' && !e.name.startsWith('.') && /\.md$/i.test(e.name))
      .map((e) => e.name);
  }

  /**
   * Read-modify-write the file behind `cardId`: resolves the card's file name,
   * applies `mutate` through {@link updateCardFile} and fires on a write.
   * Returns whether the card was written — false for an unknown card, an
   * unreadable file, or a `mutate` that declined. Every card mutator goes
   * through here so "resolve, write, notify" exists once.
   */
  private updateCard(
    boardId: string,
    cardId: string,
    mutate: (
      data: Record<string, unknown>,
      body: string,
    ) => { data: Record<string, unknown>; body: string } | undefined,
  ): boolean {
    const fileName = this.cardFileNames(boardId).find((n) => slugFromFileName(n) === cardId);
    if (!fileName) {
      return false;
    }
    const changed = this.updateCardFile(boardId, fileName, mutate);
    if (changed) {
      this.fire();
    }
    return changed;
  }

  /**
   * Read-modify-write a single card file: parses its frontmatter, runs `mutate`,
   * and — when `mutate` returns a result — stamps `updatedAt` and writes it back.
   * Returns whether a write happened; a missing file or a `mutate` that returns
   * `undefined` is a no-op.
   */
  private updateCardFile(
    boardId: string,
    fileName: string,
    mutate: (
      data: Record<string, unknown>,
      body: string,
    ) => { data: Record<string, unknown>; body: string } | undefined,
  ): boolean {
    const path = `boards/${boardId}/${fileName}`;
    const content = this.fs.readFile(path);
    if (content === undefined) {
      return false;
    }
    const { data, body } = parseFrontmatter(content);
    const result = mutate(data, body);
    if (result === undefined) {
      return false;
    }
    result.data['updatedAt'] = this.now();
    this.fs.writeFile(path, serializeFrontmatter(result.data, result.body));
    return true;
  }

  private readBoardCards(boardId: string): CardEntry[] {
    const fields = this.readConfig(boardId).fields;
    const entries: CardEntry[] = [];
    for (const fileName of this.cardFileNames(boardId)) {
      const content = this.fs.readFile(`boards/${boardId}/${fileName}`);
      if (content === undefined) {
        continue; // unreadable — skip
      }
      const entry = parseCard(fileName, content, fields);
      if (entry) {
        entries.push(entry);
      }
    }
    entries.sort((a, b) => {
      const an = a.num ?? Number.MAX_SAFE_INTEGER;
      const bn = b.num ?? Number.MAX_SAFE_INTEGER;
      if (an !== bn) {
        return an - bn;
      }
      return a.fileName.localeCompare(b.fileName);
    });
    return entries;
  }

  /** Renames every card file to a contiguous `NN-slug.md`, changed files only. */
  private renumber(boardId: string, ordered: Array<{ slug: string; currentFile: string }>): void {
    const width = Math.max(2, String(ordered.length).length);
    const dir = `boards/${boardId}`;
    const ops: Array<{ from: string; to: string }> = [];
    ordered.forEach((entry, i) => {
      const newName = `${pad(i + 1, width)}-${entry.slug}.md`;
      if (newName !== entry.currentFile) {
        ops.push({ from: `${dir}/${entry.currentFile}`, to: `${dir}/${newName}` });
      }
    });
    if (ops.length === 0) {
      return;
    }
    // Two-phase via temp names so number swaps never clobber a sibling.
    const staged = ops.map((op, i) => ({
      from: op.from,
      tmp: `${dir}/.renumber-${i}.tmp`,
      to: op.to,
    }));
    for (const s of staged) {
      this.fs.rename(s.from, s.tmp);
    }
    for (const s of staged) {
      this.fs.rename(s.tmp, s.to);
    }
  }

  // ---- decisions ----

  listDecisions(): DecisionRecord[] {
    return this.decisions.list();
  }

  getDecision(id: string): DecisionRecord | undefined {
    return this.decisions.get(id);
  }

  createDecision(title: string): string {
    const id = this.decisions.create(title, this.today());
    this.fire();
    return id;
  }

  /**
   * Rewrites a decision's `status:` frontmatter key, adding frontmatter when
   * the file has none. The body is preserved byte-for-byte. Fires. Returns
   * whether the decision exists (validating `status` is the caller's job).
   */
  setDecisionStatus(id: string, status: string): boolean {
    const changed = this.decisions.setStatus(id, status);
    if (changed) {
      this.fire();
    }
    return changed;
  }

  // ---- feature sets ----

  /** Every `features/<set-id>/` folder, with its feature count. */
  listFeatureSets(): FeatureSetRef[] {
    return this.features.listSets();
  }

  /**
   * A feature set rendered as board data — columns from its `.config.json`,
   * one card per `.feature` file. `undefined` when the set does not exist.
   */
  getFeatureSet(setId: string): BoardData | undefined {
    return this.features.board(setId);
  }

  /** The set's labels and fields, in the same shape as a board's config. */
  getFeatureSetConfig(setId: string): RepoDocConfig {
    return this.features.config(setId);
  }

  featureSetDisplayPath(setId: string): string {
    return this.features.displayPath(setId);
  }

  getFeature(setId: string, featureId: string): FeatureRecord | undefined {
    return this.features.get(setId, featureId);
  }

  /** Path of a feature file relative to the root, for hosts that open it. */
  featureFilePath(setId: string, featureId: string): string | undefined {
    return this.features.filePath(setId, featureId);
  }

  createFeatureSet(name: string): string {
    const id = this.features.createSet(name);
    this.fire();
    return id;
  }

  /** Creates `<slug>.feature` in the set's first column (or `columnId`). */
  createFeature(setId: string, title: string, columnId?: string): AddCardResult {
    const result = this.features.create(setId, title, columnId);
    if (result.ok) {
      this.fire();
    }
    return result;
  }

  /**
   * Moves a feature by rewriting only its `@status:` tag. Gates are NOT
   * evaluated for features in this iteration.
   */
  moveFeature(setId: string, featureId: string, columnId: string): MoveCardResult {
    const result = this.features.move(setId, featureId, columnId);
    if (result.ok) {
      this.fire();
    }
    return result;
  }

  // ---- docs ----

  getDocsTree(): DocNode[] {
    return this.docs.tree();
  }

  readDoc(
    relPath: string,
  ): { title: string; body: string; frontmatter?: Record<string, unknown> } | undefined {
    return this.docs.read(relPath);
  }

  // ---- clock helpers ----

  private now(): string {
    return this.clock.now().toISOString();
  }

  private today(): string {
    return this.clock.now().toISOString().slice(0, 10);
  }
}

/**
 * Collapses any CR/LF run in a frontmatter scalar to a single space. Card
 * frontmatter is one `key: value` per line, so an unfiltered newline in a value
 * forges a second key — a "status" of "busy\ncolumn: done" would move the card.
 */
function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ');
}

/** {@link oneLine} for a patch value, leaving `null` / `undefined` alone. */
function oneLineOrKeep<T>(value: T): T | string {
  return typeof value === 'string' ? oneLine(value) : value;
}

/** Applies one {@link CardMetaPatch} key: undefined → keep, null → remove, else set. */
function applyMetaKey(data: Record<string, unknown>, key: string, value: unknown): void {
  if (value === undefined) {
    return;
  }
  if (value === null) {
    delete data[key];
  } else {
    data[key] = value;
  }
}

/** Formats a value as the on-disk JSON file content (pretty, trailing newline). */
function jsonFileContent(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * Validates `value` against a field def, returning the value to write or
 * `undefined` when the type is wrong. A valid-but-empty multiselect resolves to
 * an inner `undefined`, signalling the caller to remove the key.
 */
function coerceFieldValue(
  def: CustomFieldDef,
  value: CustomFieldValue,
): { value: CustomFieldValue | undefined } | undefined {
  switch (def.type) {
    case 'text':
    case 'date':
    case 'select':
      return typeof value === 'string' ? { value: oneLine(value) } : undefined;
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? { value } : undefined;
    case 'boolean':
      return typeof value === 'boolean' ? { value } : undefined;
    case 'multiselect': {
      let arr: string[] | undefined;
      if (typeof value === 'string') {
        arr = [oneLine(value)];
      } else if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
        arr = value.map(oneLine);
      } else {
        return undefined;
      }
      return { value: arr.length ? arr : undefined };
    }
    default:
      return undefined;
  }
}
