import { ClockPort, Disposable, FileSystemPort } from './ports';
import { parseFrontmatter, serializeFrontmatter } from './frontmatter';
import { pad, slugFromFileName, slugify, titleCase } from './naming';
import {
  BoardConfig,
  DEFAULT_LABELS,
  defaultColumns,
  normalizeBoardConfig,
} from './boardConfig';
import { computeCardOrder } from './ordering';
import { CardEntry, findChecklist, parseCard } from './cardParse';
import { evaluateTransition } from './gates';
import { DecisionStore } from './decisions';
import { DocStore } from './docs';
import { FeatureStore } from './features';
import { seedBoardConfig } from './seed';
import {
  BoardData,
  BoardRef,
  Card,
  Column,
  CustomFieldDef,
  CustomFieldValue,
  DecisionRecord,
  DocNode,
  FeatureRecord,
  FeatureSetRef,
  GateResult,
  Priority,
  RepoDocConfig,
} from './types';

/** Why a store mutation was refused. Mutations never throw for these. */
export type StoreError =
  | { code: 'unknown-board'; boardId: string }
  | { code: 'unknown-card'; cardId: string }
  | { code: 'unknown-column'; columnId: string }
  | { code: 'duplicate-slugs'; slug: string }
  | { code: 'unreadable-card'; cardId: string };

export type MoveCardResult = { ok: true } | { ok: false; error: StoreError };

export type AddCardResult = { ok: true; cardId: string } | { ok: false; error: StoreError };

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

  private configPath(boardId: string): string {
    return `boards/${boardId}/.config.json`;
  }

  /** Writes a board config and notifies listeners. */
  private writeConfig(boardId: string, config: BoardConfig): void {
    this.fs.writeFile(this.configPath(boardId), jsonFileContent(config));
    this.fire();
  }

  private readConfig(boardId: string): BoardConfig {
    const raw = this.fs.readFile(this.configPath(boardId));
    if (raw === undefined) {
      return normalizeBoardConfig(undefined, boardId);
    }
    try {
      return normalizeBoardConfig(JSON.parse(raw), boardId);
    } catch {
      return normalizeBoardConfig(undefined, boardId);
    }
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
    const columns: Column[] = config.columns.map((c) => ({
      id: c.id,
      name: c.name || titleCase(c.id),
      color: c.color || '#7d828b',
      wip: c.wip,
      enter: c.enter,
      exit: c.exit,
      prompt: c.prompt,
      cardIds: [],
    }));
    const byId = new Map(columns.map((c) => [c.id, c]));

    const cards: Record<string, Card> = {};
    for (const entry of this.readBoardCards(id)) {
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
    const taken = new Set(entries.map((e) => e.slug));
    const base = slugify(title, 'card');
    let slug = base;
    let suffix = 2;
    while (taken.has(slug)) {
      slug = `${base}-${suffix}`;
      suffix++;
    }
    const maxNum = entries.reduce((max, e) => Math.max(max, e.num ?? 0), 0);
    const num = maxNum + 1;
    const width = Math.max(2, String(num).length);
    const fileName = `${pad(num, width)}-${slug}.md`;

    const data: Record<string, unknown> = { column: columnId, updatedAt: this.now() };
    const body = `# ${title.trim()}\n`;
    this.fs.writeFile(`boards/${boardId}/${fileName}`, serializeFrontmatter(data, body));
    this.fire();
    return { ok: true, cardId: slug };
  }

  addColumn(boardId: string, name: string): void {
    const config = this.readConfig(boardId);
    const id = slugify(name);
    config.columns.push({ id, name: name.trim() || titleCase(id), color: '#7d828b' });
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
      data.column = toColumnId;
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
   */
  updateCardMeta(boardId: string, cardId: string, patch: CardMetaPatch): boolean {
    const fileName = this.cardFileNames(boardId).find((n) => slugFromFileName(n) === cardId);
    if (!fileName) {
      return false;
    }
    const changed = this.updateCardFile(boardId, fileName, (data, body) => {
      applyMetaKey(data, 'labels', patch.labels);
      applyMetaKey(data, 'priority', patch.priority);
      applyMetaKey(data, 'agent', patch.agent);
      applyMetaKey(data, 'live', patch.live);
      applyMetaKey(data, 'status', patch.status);
      applyMetaKey(data, 'progress', patch.progress);
      const nextBody = patch.title === undefined ? body : replaceTitle(body, patch.title);
      return { data, body: nextBody };
    });
    if (changed) {
      this.fire();
    }
    return changed;
  }

  toggleChecklistItem(boardId: string, cardId: string, itemIndex: number): void {
    const fileName = this.cardFileNames(boardId).find((name) => slugFromFileName(name) === cardId);
    if (!fileName) {
      return;
    }
    const changed = this.updateCardFile(boardId, fileName, (data, body) => {
      const { indices } = findChecklist(body);
      if (itemIndex < 0 || itemIndex >= indices.length) {
        return undefined; // out of range — leave the file untouched
      }
      const bodyLines = body.split('\n');
      const li = indices[itemIndex];
      bodyLines[li] = bodyLines[li].replace(/\[([ xX])\]/, (_m, c: string) =>
        c.toLowerCase() === 'x' ? '[ ]' : '[x]',
      );
      return { data, body: bodyLines.join('\n') };
    });
    if (changed) {
      this.fire();
    }
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
    const fileName = this.cardFileNames(boardId).find((n) => slugFromFileName(n) === cardId);
    if (!fileName) {
      return false;
    }
    const changed = this.updateCardFile(boardId, fileName, (data, body) => ({
      data,
      body: appendChecklistLine(body, text),
    }));
    if (changed) {
      this.fire();
    }
    return changed;
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
    const fileName = this.cardFileNames(boardId).find((n) => slugFromFileName(n) === cardId);
    if (!fileName) {
      return false;
    }
    const changed = this.updateCardFile(boardId, fileName, (data, body) => ({
      data,
      body: replaceDescription(body, text),
    }));
    if (changed) {
      this.fire();
    }
    return changed;
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
    const fileName = this.cardFileNames(boardId).find((n) => slugFromFileName(n) === cardId);
    if (!fileName) {
      return;
    }
    const changed = this.updateCardFile(boardId, fileName, (data, body) => {
      if (write === undefined) {
        delete data[fieldId];
      } else {
        data[fieldId] = write;
      }
      return { data, body };
    });
    if (changed) {
      this.fire();
    }
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
    const fileName = this.cardFileNames(boardId).find((n) => slugFromFileName(n) === cardId);
    if (!fileName) {
      return;
    }
    const at = this.now();
    const changed = this.updateCardFile(boardId, fileName, (data, body) => ({
      data,
      body: appendCommentLine(body, who, at, text),
    }));
    if (changed) {
      this.fire();
    }
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
    const fileName = this.cardFileNames(boardId).find((n) => slugFromFileName(n) === cardId);
    if (!fileName) {
      return false;
    }
    const changed = this.updateCardFile(boardId, fileName, (data, body) => ({
      data,
      body: upsertGateLine(body, gateId, note),
    }));
    if (changed) {
      this.fire();
    }
    return changed;
  }

  // ---- card file helpers ----

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
    result.data.updatedAt = this.now();
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

/** Rewrites the body's first `# ` heading to `title`, inserting one when absent. */
function replaceTitle(body: string, title: string): string {
  const lines = body.split('\n');
  const idx = lines.findIndex((l) => /^#\s+/.test(l));
  const heading = `# ${title.replace(/\s+/g, ' ').trim()}`;
  if (idx === -1) {
    return `${heading}\n${body.startsWith('\n') || body === '' ? '' : '\n'}${body}`;
  }
  lines[idx] = heading;
  return lines.join('\n');
}

/** Formats a value as the on-disk JSON file content (pretty, trailing newline). */
function jsonFileContent(value: unknown): string {
  return JSON.stringify(value, null, 2) + '\n';
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
      return typeof value === 'string' ? { value } : undefined;
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? { value } : undefined;
    case 'boolean':
      return typeof value === 'boolean' ? { value } : undefined;
    case 'multiselect': {
      let arr: string[] | undefined;
      if (typeof value === 'string') {
        arr = [value];
      } else if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
        arr = value;
      } else {
        return undefined;
      }
      return { value: arr.length ? arr : undefined };
    }
    default:
      return undefined;
  }
}

/**
 * Appends a journal entry to the card body's `## Comments` section. The entry is
 * `- **<who>** (<at>): <text>` with any continuation lines of a multi-line text
 * indented two spaces. An existing section gets the entry appended after its
 * last non-blank line; when absent, a `## Comments` section is created at the
 * end of the body (which is after any `## Gates` section). Other bytes are kept.
 */
function appendCommentLine(body: string, who: string, at: string, text: string): string {
  const textLines = text.split('\n');
  // Continuations are indented two spaces; blank paragraph breaks stay truly
  // empty (the parser keeps them inside the entry when a continuation follows).
  const block = [
    `- **${who}** (${at}): ${textLines[0]}`,
    ...textLines.slice(1).map((l) => (l.trim() === '' ? '' : `  ${l}`)),
  ].join('\n');

  const lines = body.split('\n');
  const headingIdx = lines.findIndex((l) => /^##\s+comments\s*$/i.test(l));
  if (headingIdx === -1) {
    const trimmed = body.replace(/\s+$/, '');
    const prefix = trimmed.length ? `${trimmed}\n\n` : '';
    return `${prefix}## Comments\n\n${block}\n`;
  }

  // Section spans from the heading to the next heading (or end of body).
  let end = lines.length;
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (/^#{1,6}\s+/.test(lines[i])) {
      end = i;
      break;
    }
  }
  let insertAt = end;
  while (insertAt > headingIdx + 1 && lines[insertAt - 1].trim() === '') {
    insertAt--;
  }
  lines.splice(insertAt, 0, block);
  return lines.join('\n');
}

/**
 * Appends `- [ ] <text>` to the card body's `## Checklist` section, after its
 * last non-blank line. When absent, a `## Checklist` section is inserted
 * right before the first `## Gates` / `## Comments` heading (or at the end of
 * the body when there is neither) — RepoDoc's mandated section order is
 * Checklist, Gates, Comments. `text` is collapsed to a single line. Other
 * bytes are preserved.
 */
function appendChecklistLine(body: string, text: string): string {
  const line = `- [ ] ${text.replace(/\s+/g, ' ').trim()}`;
  const lines = body.split('\n');

  const headingIdx = lines.findIndex((l) => /^##\s+checklist\s*$/i.test(l));
  if (headingIdx !== -1) {
    // Section spans from the heading to the next heading (or end of body).
    let end = lines.length;
    for (let i = headingIdx + 1; i < lines.length; i++) {
      if (/^#{1,6}\s+/.test(lines[i])) {
        end = i;
        break;
      }
    }
    let insertAt = end;
    while (insertAt > headingIdx + 1 && lines[insertAt - 1].trim() === '') {
      insertAt--;
    }
    lines.splice(insertAt, 0, line);
    return lines.join('\n');
  }

  // No existing section — insert a new one before Gates/Comments, else at the end.
  let sectionIdx = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+(gates|comments)\s*$/i.test(lines[i])) {
      sectionIdx = i;
      break;
    }
  }
  const before = lines.slice(0, sectionIdx);
  while (before.length && before[before.length - 1].trim() === '') {
    before.pop();
  }
  const after = lines.slice(sectionIdx);

  const out: string[] = [...before];
  if (out.length) {
    out.push('');
  }
  out.push('## Checklist', '', line);
  if (after.length) {
    out.push('', ...after);
  } else {
    out.push('');
  }
  return out.join('\n');
}

/**
 * Replaces the body text between the `# ` title line and the first `## `
 * heading (or end of body) with `text`, trimmed and surrounded by a single
 * blank line on each side. A body with no `# ` heading treats position 0 as
 * the start of the description. Empty `text` removes the description
 * entirely. All other bytes are preserved.
 */
function replaceDescription(body: string, text: string): string {
  const clean = text.trim();
  const lines = body.split('\n');
  const titleIdx = lines.findIndex((l) => /^#\s+/.test(l));
  const start = titleIdx === -1 ? 0 : titleIdx + 1;
  let end = lines.length;
  for (let i = start; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) {
      end = i;
      break;
    }
  }
  const before = lines.slice(0, start);
  const after = lines.slice(end);
  const middle = clean ? clean.split('\n') : [];

  const groups = [before, middle, after].filter((g) => g.length > 0);
  const parts: string[] = [];
  groups.forEach((g, i) => {
    if (i > 0) {
      parts.push('');
    }
    parts.push(...g);
  });
  if (after.length === 0 && parts[parts.length - 1] !== '') {
    parts.push(''); // keep the body's trailing newline
  }
  return parts.join('\n');
}

const GATE_SEPARATOR = ' — ';

/**
 * Inserts or replaces a done `- [x] <gateId> — <note>` line in the card body's
 * `## Gates` section. An existing line for the gate is replaced in place; a new
 * gate is appended to the end of the section. When there is no `## Gates`
 * section, one is appended at the end of the body. All other bytes are
 * preserved.
 */
function upsertGateLine(body: string, gateId: string, note: string): string {
  const line = `- [x] ${gateId}${GATE_SEPARATOR}${note}`;
  const lines = body.split('\n');

  const headingIdx = lines.findIndex((l) => /^##\s+gates\s*$/i.test(l));
  if (headingIdx === -1) {
    const trimmed = body.replace(/\s+$/, '');
    const prefix = trimmed.length ? `${trimmed}\n\n` : '';
    return `${prefix}## Gates\n\n${line}\n`;
  }

  // Section spans from the heading to the next heading (or end of body).
  let end = lines.length;
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (/^#{1,6}\s+/.test(lines[i])) {
      end = i;
      break;
    }
  }

  for (let i = headingIdx + 1; i < end; i++) {
    const m = /^\s*-\s+\[([ xX])\]\s+(.*)$/.exec(lines[i]);
    if (!m) {
      continue;
    }
    const text = m[2].trim();
    const sep = text.indexOf(GATE_SEPARATOR);
    const existingId = sep === -1 ? text : text.slice(0, sep).trim();
    if (existingId === gateId) {
      lines[i] = line;
      return lines.join('\n');
    }
  }

  // Append after the section's last non-blank line.
  let insertAt = end;
  while (insertAt > headingIdx + 1 && lines[insertAt - 1].trim() === '') {
    insertAt--;
  }
  lines.splice(insertAt, 0, line);
  return lines.join('\n');
}
