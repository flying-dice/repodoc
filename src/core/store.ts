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
  GateResult,
  RepoDocConfig,
} from './types';

/**
 * RepoDoc's data store, built on the new on-disk layout. It talks to the
 * filesystem and the clock only through ports, so it never imports 'vscode'
 * and stays unit-testable against an in-memory adapter.
 *
 * Board logic lives here; decisions and docs are delegated to the dedicated
 * stores in `decisions.ts` / `docs.ts`, keeping each domain focused.
 */
export class RepoDocStore {
  /** Absolute workspace path — metadata only (e.g. for the host's openFile). */
  readonly root: string | undefined;

  private readonly listeners: Array<() => void> = [];
  private readonly decisions: DecisionStore;
  private readonly docs: DocStore;

  constructor(
    private readonly fs: FileSystemPort,
    private readonly clock: ClockPort,
    root?: string,
  ) {
    this.root = root;
    this.decisions = new DecisionStore(fs);
    this.docs = new DocStore(fs);
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
    return this.fs.exists('boards') || this.fs.exists('decisions');
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

  addCard(boardId: string, columnId: string, title: string): void {
    const config = this.readConfig(boardId);
    if (!config.columns.some((c) => c.id === columnId)) {
      return;
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
  }

  addColumn(boardId: string, name: string): void {
    const config = this.readConfig(boardId);
    const id = slugify(name);
    config.columns.push({ id, name: name.trim() || titleCase(id), color: '#7d828b' });
    this.writeConfig(boardId, config);
  }

  moveCard(boardId: string, cardId: string, toColumnId: string, index: number): void {
    const entries = this.readBoardCards(boardId);
    const moved = entries.find((e) => e.slug === cardId);
    if (!moved) {
      return; // unknown card — never delete
    }
    // Slugs are card identities. Externally-authored files can collide (two
    // NN-foo.md files); renumbering would then rename one file over the other
    // and destroy it, so refuse to reorder until the collision is resolved.
    const seen = new Set<string>();
    for (const e of entries) {
      if (seen.has(e.slug)) {
        return;
      }
      seen.add(e.slug);
    }
    const config = this.readConfig(boardId);
    if (!config.columns.some((c) => c.id === toColumnId)) {
      return; // unknown column
    }

    // Set the card's column in its frontmatter (same file name, updatedAt stamped).
    const updated = this.updateCardFile(boardId, moved.fileName, (data, body) => {
      data.column = toColumnId;
      return { data, body };
    });
    if (!updated) {
      return;
    }

    // Compute the new global card order, then renumber files to match.
    const newOrder = computeCardOrder(entries, cardId, toColumnId, index);
    const slugToFile = new Map(entries.map((e) => [e.slug, e.fileName]));
    this.renumber(
      boardId,
      newOrder.map((slug) => ({ slug, currentFile: slugToFile.get(slug) as string })),
    );
    this.fire();
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

  /** Records a manual override for `gateId` on a card's `## Gates` section. */
  recordGateOverride(boardId: string, cardId: string, gateId: string, who: string): void {
    this.recordGate(boardId, cardId, gateId, `OVERRIDDEN (${who}, ${this.now()})`);
  }

  private recordGate(boardId: string, cardId: string, gateId: string, note: string): void {
    const fileName = this.cardFileNames(boardId).find((n) => slugFromFileName(n) === cardId);
    if (!fileName) {
      return;
    }
    const changed = this.updateCardFile(boardId, fileName, (data, body) => ({
      data,
      body: upsertGateLine(body, gateId, note),
    }));
    if (changed) {
      this.fire();
    }
  }

  // ---- card file helpers ----

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
