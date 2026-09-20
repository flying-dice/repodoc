/**
 * Block-level markdown diffing for the reading surfaces.
 *
 * Diffing rendered HTML loses the structure and diffing raw lines is noisy and
 * unrenderable, so the comparison is made over *parsed* blocks. RepoDoc owns
 * none of the parsing: the reading view's own Marked lexer says what a block
 * is, where a fence ends and which item owns a nested list, and
 * {@link https://www.npmjs.com/package/diff | jsdiff} aligns the two sides.
 * What is left here is only policy — which differences are permitted
 * equivalences, and what a caller is handed to render.
 *
 * That split is the point. The previous implementation recognised markdown
 * itself, with its own fence rules, indentation stack and paragraph-state
 * machine, and every defect in it was the same defect: a second parser
 * disagreeing with the real one about what owned a line. A rule added to it
 * fixed one document and broke the next.
 *
 * Three consequences of parsing-first are worth stating, because they are
 * deliberate:
 *
 *  - **Whole containers are atomic.** A list, table or blockquote is one unit,
 *    so editing one item reports the list as changed. That is coarser than
 *    before and it is structurally honest — the item is rendered inside its own
 *    parent, from its own tokens, never rebuilt from a markdown fragment.
 *  - **Original tokens are rendered, never a reconstruction.** Removed content
 *    is rendered from the old document's tokens and added content from the
 *    new. Comparison keys are separate data; they never stand in for content.
 *  - **There is no word-level diff inside a changed block.** A reworded
 *    paragraph reads as one removal followed by one addition.
 */

import { diffArrays } from 'diff';
import { Marked, type Token, type Tokens } from 'marked';
import { parseFrontmatter } from './frontmatter';

export type DiffOp = 'same' | 'add' | 'del';

/**
 * The parser configuration both the diff and the reading view must share.
 *
 * If the two ever disagreed the diff would be describing a document nobody is
 * looking at, so the renderer imports this rather than repeating it.
 */
export const MARKDOWN_OPTIONS = { gfm: true } as const;

const markdown = new Marked(MARKDOWN_OPTIONS);

/** A `[label]: destination "title"` definition, as the parser resolved it. */
export interface ReferenceDefinition {
  label: string;
  href: string;
  title: string;
}

export interface LexedDocument {
  /** Top-level block tokens, in document order. Blank space is not a block. */
  tokens: Token[];
  /** Every reference definition in the document, label-sorted. */
  definitions: ReferenceDefinition[];
}

/** Contiguous blocks sharing an op, rendered together from their own tokens. */
export interface DiffRun {
  op: DiffOp;
  /** What a reader sees: the new side for `same` and `add`, the old for `del`. */
  tokens: Token[];
  /**
   * For a `same` run, the old side's *own* tokens.
   *
   * Matched blocks are equivalent, not identical — a reflowed paragraph
   * matches the one it was reflowed from. Keeping only the new side would mean
   * the old document could not be reconstructed from a diff of it, and a
   * caller rendering "what this looked like before" would be shown the new
   * spelling. Same length and order as {@link tokens}.
   */
  oldTokens: Token[];
}

/** Definitions that only exist on one side. */
export interface DefinitionChange {
  removed: ReferenceDefinition[];
  added: ReferenceDefinition[];
}

export interface MarkdownDiff {
  /** The whole document in order, in runs of one op. */
  runs: DiffRun[];
  /**
   * Reference definitions that changed. They render to no output of their own,
   * so an edit to one is invisible in `runs` and is reported here instead.
   */
  definitions: DefinitionChange;
  /** Blocks added and removed, for the legend counts. */
  added: number;
  removed: number;
  /**
   * Whether alignment was unavailable and the whole document is reported as
   * replaced. A coarse answer, never a silent "unchanged".
   */
  coarse: boolean;
}

/**
 * The most alignment cells this will ask for, and so the most work one diff
 * will do. Four million is large enough that no document anyone reads comes
 * near it, small enough that the extension host never disappears into a huge
 * allocation.
 *
 * Exported so the fallback can be tested from both sides of it rather than by
 * trying to exhaust the host.
 */
export const DIFF_BUDGET_CELLS = 4_000_000;

/**
 * How long alignment may run before jsdiff abandons it. Exceeding either limit
 * means *fine-grained comparison unavailable* — it must never be read as
 * nothing having changed, so the coarse path still compares the two sides.
 */
export const DIFF_TIMEOUT_MS = 2_000;

/**
 * Parse a document with the reading view's parser.
 *
 * The whole document is lexed at once, never a fragment: reference links only
 * resolve against definitions elsewhere in the same document, and a fragment
 * can be read differently from the text it was cut out of.
 */
export function lexMarkdown(source: string): LexedDocument {
  const tokens = markdown.lexer(source.replace(/\r\n?/g, '\n'));
  const links = (
    tokens as { links?: Record<string, { href?: string | null; title?: string | null }> }
  ).links;
  const definitions = Object.entries(links ?? {})
    .map(([label, target]) => ({
      label,
      href: target?.href ?? '',
      title: target?.title ?? '',
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
  // `space` is the blank line between blocks, not a block.
  return { tokens: tokens.filter((token) => token.type !== 'space'), definitions };
}

/** `[label]: destination "title"` lines, as a reader would have written them. */
export function definitionSource(definitions: ReferenceDefinition[]): string {
  return definitions
    .map((d) => `[${d.label}]: ${d.href}${d.title === '' ? '' : ` "${d.title}"`}`)
    .join('\n');
}

/**
 * The limits alignment runs under. Every one of them, when hit, means
 * *fine-grained comparison unavailable* rather than *unchanged*.
 *
 * Callers override them to work on a tighter leash than the defaults — and
 * tests exercise the fallback through them rather than by building a document
 * big enough to exhaust the host, which would put a multi-second parse in the
 * suite to prove a branch that is three lines long.
 */
export interface DiffLimits {
  /** Alignment cells; past this, alignment is refused before it is attempted. */
  budgetCells?: number;
  /** Milliseconds jsdiff may spend before it abandons the alignment. */
  timeoutMs?: number;
  /** Edit distance past which jsdiff gives up. Unbounded by default. */
  maxEditLength?: number;
}

/**
 * Diff two markdown documents. Within a changed region removals are emitted
 * before additions, so the old text reads above the new.
 */
export function diffMarkdown(before: string, after: string, limits: DiffLimits = {}): MarkdownDiff {
  const oldDoc = lexMarkdown(before);
  const newDoc = lexMarkdown(after);
  const { runs, coarse } = alignTokens(oldDoc.tokens, newDoc.tokens, limits);
  const definitions = definitionChange(oldDoc.definitions, newDoc.definitions);

  const total = (op: DiffOp): number =>
    runs.filter((run) => run.op === op).reduce((n, run) => n + run.tokens.length, 0);

  return {
    runs,
    definitions,
    added: total('add') + definitions.added.length,
    removed: total('del') + definitions.removed.length,
    coarse,
  };
}

/**
 * One side of a diff as tokens: what that side's document actually was.
 *
 * Matched runs contribute their own side, so rendering this reproduces that
 * document rather than a blend of the two.
 */
export function projectTokens(diff: MarkdownDiff, side: 'old' | 'new'): Token[] {
  return diff.runs.flatMap((run) => {
    if (run.op === 'same') {
      return side === 'old' ? run.oldTokens : run.tokens;
    }
    return (side === 'old') === (run.op === 'del') ? run.tokens : [];
  });
}

/** True when an already-computed diff reports anything at all. */
export function hasChanges(diff: MarkdownDiff): boolean {
  return (
    diff.runs.some((run) => run.op !== 'same') ||
    diff.definitions.added.length > 0 ||
    diff.definitions.removed.length > 0
  );
}

/**
 * Whether two documents differ at all. Answering yes/no needs no alignment, so
 * this compares comparison keys in one pass rather than paying for the
 * alignment {@link diffMarkdown} runs.
 *
 * It is the same key function and the same parse, so the two can only ever
 * agree about whether something changed.
 */
export function hasMarkdownChanges(before: string, after: string): boolean {
  return documentKey(lexMarkdown(before)) !== documentKey(lexMarkdown(after));
}

function documentKey(doc: LexedDocument): string {
  // Serialised as one structure, not joined: a joined string can be forged
  // from inside a field, which is the same flaw the token keys avoid.
  return JSON.stringify([doc.tokens.map(comparisonKey), doc.definitions]);
}

function definitionChange(
  before: ReferenceDefinition[],
  after: ReferenceDefinition[],
): DefinitionChange {
  const key = (d: ReferenceDefinition): string => JSON.stringify([d.label, d.href, d.title]);
  const oldKeys = new Set(before.map(key));
  const newKeys = new Set(after.map(key));
  return {
    removed: before.filter((d) => !newKeys.has(key(d))),
    added: after.filter((d) => !oldKeys.has(key(d))),
  };
}

/**
 * Align two token sequences, falling back to a whole-document replacement when
 * fine-grained alignment is unavailable.
 *
 * jsdiff returns `undefined` when a limit is hit. That means *no alignment*,
 * not *no change*, so the fallback still compares the two sides and only
 * reports them unchanged when they really match.
 */
function alignTokens(
  oldTokens: Token[],
  newTokens: Token[],
  limits: DiffLimits,
): { runs: DiffRun[]; coarse: boolean } {
  const budget = limits.budgetCells ?? DIFF_BUDGET_CELLS;
  const withinBudget = (oldTokens.length + 1) * (newTokens.length + 1) <= budget;
  const changes = withinBudget
    ? diffArrays(oldTokens, newTokens, {
        comparator: sameToken,
        timeout: limits.timeoutMs ?? DIFF_TIMEOUT_MS,
        ...(limits.maxEditLength === undefined ? {} : { maxEditLength: limits.maxEditLength }),
      })
    : undefined;

  if (changes === undefined) {
    return { runs: coarseRuns(oldTokens, newTokens), coarse: true };
  }

  // Walked with a cursor into each side rather than trusting `value` to be the
  // side wanted: for a matched run jsdiff hands back one array, and the two
  // sides of that match are different tokens that merely compare equal.
  const runs: DiffRun[] = [];
  let oldAt = 0;
  let newAt = 0;
  for (const change of changes) {
    const count = change.value.length;
    if (count === 0) {
      continue;
    }
    if (change.added === true) {
      runs.push({ op: 'add', tokens: newTokens.slice(newAt, newAt + count), oldTokens: [] });
      newAt += count;
    } else if (change.removed === true) {
      runs.push({ op: 'del', tokens: oldTokens.slice(oldAt, oldAt + count), oldTokens: [] });
      oldAt += count;
    } else {
      runs.push({
        op: 'same',
        tokens: newTokens.slice(newAt, newAt + count),
        oldTokens: oldTokens.slice(oldAt, oldAt + count),
      });
      oldAt += count;
      newAt += count;
    }
  }
  return { runs: removalsFirst(runs), coarse: false };
}

/**
 * The old text reads above the new, whichever order the aligner emitted a
 * replacement in.
 */
function removalsFirst(runs: DiffRun[]): DiffRun[] {
  const out = [...runs];
  for (let i = 0; i + 1 < out.length; i++) {
    const first = out[i] as DiffRun;
    const second = out[i + 1] as DiffRun;
    if (first.op === 'add' && second.op === 'del') {
      out[i] = second;
      out[i + 1] = first;
    }
  }
  return out;
}

function coarseRuns(oldTokens: Token[], newTokens: Token[]): DiffRun[] {
  const identical =
    oldTokens.length === newTokens.length &&
    oldTokens.every((token, i) => sameToken(token, newTokens[i] as Token));
  if (identical) {
    return newTokens.length === 0 ? [] : [{ op: 'same', tokens: newTokens, oldTokens }];
  }
  return [
    ...(oldTokens.length === 0 ? [] : [{ op: 'del' as const, tokens: oldTokens, oldTokens: [] }]),
    ...(newTokens.length === 0 ? [] : [{ op: 'add' as const, tokens: newTokens, oldTokens: [] }]),
  ];
}

function sameToken(a: Token, b: Token): boolean {
  return comparisonKey(a) === comparisonKey(b);
}

/**
 * Keys are pure functions of a token, and tokens are compared many times
 * against each other, so each is computed once.
 */
const keyCache = new WeakMap<object, string>();

/**
 * The comparison policy, and the only place equivalences are decided.
 *
 * It reads parsed tokens rather than markdown source, so the questions it
 * answers are the ones the parser has already settled: this is a code payload,
 * that is a link destination, this text is prose. It never re-derives them.
 *
 *  - **Code payloads** — fenced, indented and inline — are compared exactly.
 *    Indentation is the control flow in Python and the structure in YAML, and
 *    two spaces inside a string literal are part of the string.
 *  - **Prose** collapses runs of whitespace, because reflowing a paragraph is
 *    not an edit. A hard break is a `br` token, so it survives that collapse,
 *    and a separator *between* inline tokens survives it too: `Hello **world**`
 *    and `Hello**world**` are two different sentences.
 *  - **Structure** — heading depth, list ordering and start, task state, table
 *    alignment — is compared as structure.
 *  - **Links and images** carry their destination and title, not just the text
 *    a reader sees; repointing a link is a change.
 *  - **Anything unrecognised**, including tokens from a parser extension, is
 *    compared by its raw source. The conservative answer is that it differs;
 *    assuming it is prose would quietly permit an edit inside it.
 *
 * The key is a nested structure serialised as JSON, not fields joined by a
 * separator. Joining is not injective: with `code|${lang}|${text}`, an info
 * string of `text|a` over a payload of `b` produces the same key as `text` over
 * `a|b`, and a code change reads as no change at all. No separator character
 * fixes that — only an encoding that cannot be forged from the inside.
 */
export function comparisonKey(token: Token): string {
  const cached = keyCache.get(token);
  if (cached !== undefined) {
    return cached;
  }
  const key = JSON.stringify(keyOf(token));
  keyCache.set(token, key);
  return key;
}

/** The key as structure, before serialisation. Nests; never flattens. */
function keyOf(token: Token): unknown[] {
  const t = token as Token & { tokens?: Token[]; text?: string; raw?: string };

  switch (token.type) {
    case 'space':
      return ['space'];

    // Code is preserved byte for byte, fenced or indented alike. The parser has
    // already decided which lines are code; the payload is taken as given.
    case 'code': {
      const code = token as Tokens.Code;
      return ['code', code.lang ?? '', code.text];
    }
    case 'codespan':
      return ['codespan', (token as Tokens.Codespan).text];

    case 'br':
      return ['br'];
    case 'hr':
      return ['hr'];

    case 'heading':
      return ['heading', (token as Tokens.Heading).depth, blockParts(t.tokens)];
    case 'paragraph':
      return ['paragraph', blockParts(t.tokens)];
    case 'blockquote':
      return ['blockquote', blockParts(t.tokens)];

    case 'list': {
      const list = token as Tokens.List;
      return ['list', list.ordered, list.start, list.loose, list.items.map(keyOf)];
    }
    case 'list_item': {
      const item = token as Tokens.ListItem;
      return ['item', item.task, item.checked ?? false, blockParts(item.tokens)];
    }

    case 'table': {
      const table = token as Tokens.Table;
      const row = (cells: Tokens.TableCell[]): unknown[] =>
        cells.map((cell) => blockParts(cell.tokens));
      return ['table', table.align, row(table.header), table.rows.map(row)];
    }

    case 'link': {
      const link = token as Tokens.Link;
      return ['link', link.href, link.title ?? '', inlineParts(link.tokens)];
    }
    case 'image': {
      const image = token as Tokens.Image;
      return ['image', image.href, image.title ?? '', prose(image.text).trim()];
    }

    case 'strong':
    case 'em':
    case 'del':
      return [token.type, inlineParts(t.tokens)];

    // Raw HTML is structure, not prose: its whitespace can be significant and
    // its attributes certainly are.
    case 'html':
    case 'def':
      return [token.type, t.raw ?? ''];

    case 'escape':
      return ['escape', t.text ?? ''];
    case 'text':
      return t.tokens !== undefined
        ? ['text', inlineParts(t.tokens)]
        : ['text', prose(t.text ?? '')];

    default:
      return [token.type, t.raw ?? ''];
  }
}

/**
 * A **block's** children, with whitespace trimmed where it touches the block's
 * own outer edge.
 *
 * Leading and trailing whitespace of a paragraph, heading, item or cell is
 * decoration: a reader sees `  hello  ` and `hello` identically. Whitespace
 * anywhere else in the flow is a word boundary and is kept.
 */
function blockParts(tokens: Token[] | undefined): unknown[] {
  const parts = (tokens ?? []).map(keyOf);
  trimEdge(parts, 0, 'leading');
  trimEdge(parts, parts.length - 1, 'trailing');
  return parts;
}

/** Drop one space where a text child meets the block's outer edge. */
function trimEdge(parts: unknown[], index: number, edge: 'leading' | 'trailing'): void {
  const part = parts[index];
  if (!Array.isArray(part) || part[0] !== 'text' || typeof part[1] !== 'string') {
    return;
  }
  const text = part[1] as string;
  parts[index] = ['text', edge === 'leading' ? text.replace(/^ /, '') : text.replace(/ $/, '')];
}

/**
 * An **inline** container's children, trimmed nowhere.
 *
 * A link, emphasis or strike is not a block: its edge sits inside the
 * surrounding text flow. Trimming it treats `[Hello ](/x)world` and
 * `[Hello](/x)world` as one document, when a reader sees "Hello world" in the
 * first and "Helloworld" in the second. The space belongs to the paragraph
 * even though the parser stores it inside the link.
 */
function inlineParts(tokens: Token[] | undefined): unknown[] {
  return (tokens ?? []).map(keyOf);
}

/**
 * Prose with the whitespace that carries no meaning removed: every run of
 * whitespace becomes one space. What is *not* removed is whether a run was
 * there at all, because that is a word boundary.
 */
function prose(text: string): string {
  return text.replace(/\s+/g, ' ');
}

/**
 * Whether two revisions of a file differ in their frontmatter.
 *
 * The reading views report *metadata changed* when git says a file moved but
 * the rendered body did not. Inferring that from a body non-match alone is
 * fragile: any false negative in block matching turns a real prose edit into a
 * confident lie about frontmatter. So the claim is checked directly — the note
 * is shown only when the frontmatter actually differs.
 *
 * Both sides are the whole file, frontmatter included.
 */
export function frontmatterChanged(before: string, after: string): boolean {
  return frontmatterDataChanged(parseFrontmatter(before).data, parseFrontmatter(after).data);
}

/**
 * The same comparison for callers that already hold the parsed records — the
 * reading views do, so they need not re-read the file to ask.
 *
 * Key order is not a change; a value is.
 */
export function frontmatterDataChanged(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): boolean {
  const key = (data: Record<string, unknown>): string =>
    JSON.stringify(Object.entries(data).sort(([a], [b]) => a.localeCompare(b)));
  return key(before) !== key(after);
}
