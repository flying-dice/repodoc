/**
 * Block-level markdown diffing for the reading surfaces.
 *
 * Diffing rendered HTML loses the structure; diffing raw lines is noisy and
 * unrenderable. So we split both sides into the smallest units that still
 * render on their own — a fenced code block, a single list item, a paragraph —
 * run a longest-common-subsequence over them, and hand the caller an ordered
 * list of blocks tagged added / removed / unchanged. Each block is still valid
 * markdown, so the existing renderer does the rest.
 *
 * There is deliberately no word-level diff inside a changed block: a reworded
 * bullet reads as one removal followed by one addition.
 *
 * Ordered lists are split per item like any other list, which costs three
 * coordinated touchpoints — {@link splitListItems} records each item's
 * position, {@link blockKey} ignores the marker so renumbering is not a change,
 * and {@link runSource} rewrites it when a list renders in pieces. That is paid
 * on purpose: numbered requirement lists are exactly the documents people diff,
 * and collapsing them to one block would report a whole list as changed because
 * one item was reworded.
 */

import { parseFrontmatter } from './frontmatter';

export type DiffOp = 'same' | 'add' | 'del';

export type BlockKind = 'fence' | 'listItem' | 'prose';

export interface MarkdownBlock {
  /** Source markdown for this block, renderable on its own. */
  text: string;
  kind: BlockKind;
  /**
   * 1-based position within its ordered list, used to restore numbering when
   * a list is rendered in several pieces. Absent for everything else.
   */
  ordinal?: number;
}

export interface DiffBlock {
  op: DiffOp;
  block: MarkdownBlock;
}

/** Contiguous blocks sharing an op, rendered together in one pass. */
export interface DiffRun {
  op: DiffOp;
  blocks: MarkdownBlock[];
}

/**
 * Opening or closing fence ticks, allowing tab or space characters in the
 * indent. Depth is gated by {@link fenceMarkerAt}: CommonMark only opens a
 * fence within three columns of the container's left margin. Matching any
 * indent treated backticks inside top-level indented code as a document fence,
 * which then swallowed later blocks and reference definitions.
 */
const FENCE_MARKER = /^[ \t]*(`{3,}|~{3,})/;
/**
 * The most LCS table cells this will allocate, and so the most work one diff
 * will do. Four million cells is a 16 MB `Int32Array` — large enough that no
 * document anyone reads comes near it, small enough that the extension host
 * never disappears into a 400 MB allocation.
 *
 * Exported so the fallback can be tested from both sides of it rather than by
 * trying to exhaust the host.
 */
export const DIFF_BUDGET_CELLS = 4_000_000;

/** Stands for a markdown hard break while prose whitespace is collapsed. */
const HARD_BREAK = '\u0000';
const LIST_MARKER = /^(\s*)([-*+]|\d+[.)])\s+/;
const ORDERED_MARKER = /^(\s*)(\d+)([.)]\s+)/;
/** `[label]:` at the head of a line; the destination may follow or be on the next. */
const DEFINITION_LABEL = /^ {0,3}\[[^\]]+\]:(.*)$/;
/** A continuation line holding only a title. */
const DEFINITION_TITLE = /^\s+("[^"]*"|'[^']*'|\([^)]*\))\s*$/;

/**
 * Split markdown into renderable blocks. Blank lines are separators and are
 * not preserved; callers rejoin blocks with a blank line between them.
 */
export function splitBlocks(source: string): MarkdownBlock[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  // Every index below is bounds-checked by the loop, but the compiler cannot
  // see that: `at` keeps the reads honest without scattering non-null casts.
  const at = (index: number): string => lines[index] ?? '';
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  /** Consume a fence from `i`, returning its text; `i` lands after the close. */
  const takeFence = (): string => {
    const marker = fenceMarkerAt(at(i)) ?? '```';
    const from = i;
    i++;
    while (i < lines.length && !closesFence(at(i), marker)) {
      i++;
    }
    if (i < lines.length) {
      i++; // consume the closing fence
    }
    // An unterminated fence swallows the rest of the file, trailing blank
    // lines included; they are not part of the code.
    return lines.slice(from, i).join('\n').replace(/\n+$/, '');
  };

  while (i < lines.length) {
    if (at(i).trim() === '') {
      i++;
      continue;
    }

    if (fenceMarkerAt(at(i)) !== undefined) {
      blocks.push({ text: takeFence(), kind: 'fence' });
      continue;
    }

    const opening = LIST_MARKER.exec(at(i));
    if (opening) {
      i = takeList(lines, i, blocks);
      continue;
    }

    // A prose group runs to the next blank line or fence.
    const from = i;
    while (i < lines.length && at(i).trim() !== '' && fenceMarkerAt(at(i)) === undefined) {
      i++;
    }
    blocks.push({ text: lines.slice(from, i).join('\n'), kind: 'prose' });
  }

  return blocks;
}

/**
 * Consume one whole list starting at `from`, pushing a block per item.
 *
 * A list is not "the lines until the next blank one". An item owns everything
 * indented under it — further paragraphs, nested lists, fenced blocks — and a
 * blank line between items makes the list *loose*, not finished. Treating each
 * blank-line group as its own list is what made numbering restart and detached
 * fenced blocks from the item that owned them.
 *
 * Numbering is the author's: the first marker sets the start, and each item
 * after it counts on from there. A list written `5. 6. 7.` keeps those numbers
 * when it renders in pieces, and one written lazily as `1. 1. 1.` still counts
 * up rather than rendering three number ones.
 *
 * Returns the index of the first line after the list.
 */
function takeList(lines: string[], from: number, out: MarkdownBlock[]): number {
  const at = (index: number): string => lines[index] ?? '';
  const opening = LIST_MARKER.exec(at(from)) as RegExpExecArray;
  // Columns, not characters — the same rule `blockKey` uses. Measuring
  // characters here made a tab-nested child under a space-indented parent look
  // like a sibling, so the two halves of this file disagreed about nesting.
  const baseIndent = indentWidth(opening[1] ?? '');
  const ordered = ORDERED_MARKER.test(at(from));
  const start = ordered ? Number(ORDERED_MARKER.exec(at(from))?.[2] ?? 1) : 0;
  // `1.` and `1)` are two different lists to a markdown parser. Sharing one
  // ordinal sequence across them renumbers a list nobody edited.
  const delimiter = markerDelimiter(at(from));

  /** Whether `line` opens an item of *this* list rather than some other one. */
  const startsThisItem = (line: string): boolean => {
    const marker = LIST_MARKER.exec(line);
    if (marker === null || indentWidth(marker[1] ?? '') > baseIndent) {
      return false;
    }
    return ORDERED_MARKER.test(line) === ordered && markerDelimiter(line) === delimiter;
  };

  /** Indented past the marker, so it belongs to the item above. */
  const isIndentedContinuation = (line: string): boolean =>
    line.trim() !== '' && indentWidth(line) > baseIndent;

  /**
   * A *lazy* continuation: an unindented line directly under an item's text,
   * which markdown folds into that item. Ending the item at the newline instead
   * lifts the text out of its `<li>` and into a paragraph of its own.
   */
  const isLazyContinuation = (line: string): boolean =>
    line.trim() !== '' &&
    !startsThisItem(line) &&
    LIST_MARKER.exec(line) === null &&
    fenceMarkerAt(line) === undefined &&
    !/^ {0,3}(#{1,6}\s|>|\s*$)/.test(line);

  let i = from;
  let position = 0;
  while (i < lines.length) {
    if (!startsThisItem(at(i))) {
      break;
    }

    const itemFrom = i;
    i++;
    for (;;) {
      if (i < lines.length && (isIndentedContinuation(at(i)) || isLazyContinuation(at(i)))) {
        i++;
        continue;
      }
      if (i < lines.length && at(i).trim() === '') {
        // A blank line only ends the item when nothing indented follows it.
        // Lazy continuation does not survive a blank line — that is a new block.
        let lookahead = i;
        while (lookahead < lines.length && at(lookahead).trim() === '') {
          lookahead++;
        }
        if (lookahead < lines.length && isIndentedContinuation(at(lookahead))) {
          i = lookahead;
          continue;
        }
      }
      break;
    }

    const text = lines.slice(itemFrom, i).join('\n').replace(/\n+$/, '');
    out.push({
      text,
      kind: 'listItem',
      ...(ordered ? { ordinal: start + position } : {}),
    });
    position++;

    // Skip the blank lines that separate a loose list's items.
    while (i < lines.length && at(i).trim() === '') {
      let next = i;
      while (next < lines.length && at(next).trim() === '') {
        next++;
      }
      if (next >= lines.length || !startsThisItem(at(next))) {
        break;
      }
      i = next;
    }
  }
  return i;
}

/** `.` or `)` for an ordered marker; the bullet character otherwise. */
function markerDelimiter(line: string): string {
  const ordered = /^\s*\d+([.)])/.exec(line);
  if (ordered?.[1]) {
    return ordered[1];
  }
  return /^\s*([-*+])/.exec(line)?.[1] ?? '';
}

/**
 * The fence marker on `line` if its indent is at most `maxIndent` columns;
 * otherwise `undefined`.
 *
 * Document-level callers leave `maxIndent` at 3. Inside a list item,
 * `blockKey` passes the item's base indent plus 3 so a tab-indented fence
 * under a space-indented item still opens and its body stays byte-for-byte.
 */
function fenceMarkerAt(line: string, maxIndent = 3): string | undefined {
  const match = FENCE_MARKER.exec(line);
  if (match === null || indentWidth(line) > maxIndent) {
    return undefined;
  }
  return match[1];
}

function closesFence(line: string, marker: string, maxIndent = 3): boolean {
  // A closer carries no info string — only the marker and trailing space.
  if (!/^[ \t]*(`{3,}|~{3,})\s*$/.test(line)) {
    return false;
  }
  const fence = fenceMarkerAt(line, maxIndent);
  return fence !== undefined && fence[0] === marker[0] && fence.length >= marker.length;
}

/**
 * Identity used for matching blocks across the two sides.
 *
 * Reflowing a paragraph is not an edit, so whitespace *within a line of prose*
 * collapses. Everything else is kept, because whitespace elsewhere is content:
 *
 *  - **Fenced blocks** are compared byte for byte. Indentation is the control
 *    flow in Python and the structure in YAML, and two spaces inside a string
 *    literal are part of the string.
 *  - **Leading indentation** decides what owns a line — which list item a
 *    continuation belongs to, and whether four spaces make it a code block.
 *  - **Two trailing spaces** are a markdown hard break, not decoration.
 *  - **Line count** is kept, so a break inserted between two lines of prose is
 *    a change even though rewrapping one line is not.
 *
 * An ordered-list marker's number is dropped so that a list renumbering does
 * not read as every item having changed.
 */
export function blockKey(block: MarkdownBlock): string {
  const source =
    block.ordinal === undefined ? block.text : block.text.replace(ORDERED_MARKER, '$1');
  const lines = source.split('\n');
  // Everything below is measured from the block's **content margin**, not from
  // the indentation of the line that opens it. A list marker shifts the margin:
  // in `- example` the item's content begins at column two, so a fence at four
  // is a nested fence and a body line at two is inside it. Measuring from the
  // marker's own indent rejected both.
  //
  // The margin comes from `block.text`, not `source`: an ordered marker has
  // already been stripped out of `source` to keep renumbering from reading as a
  // change, which would leave the marker's width unaccounted for.
  const contentMargin = contentMarginOf(block);
  // A block whose content begins four columns in is an indented code block in
  // its entirety — its first line sits *at* the margin, not past it, so the
  // per-line rule below would miss exactly that line. List items are excluded:
  // a deeply nested item is still a list item, not code.
  const wholeBlockIsCode =
    block.kind === 'fence' || (block.kind !== 'listItem' && contentMargin >= 4);

  // CommonMark opens a fence within three columns of its container's margin.
  const maxFenceIndent = contentMargin + 3;
  let inFence = false;
  let fenceMarker = '';
  const normalized = lines.map((line) => {
    const fence = fenceMarkerAt(line, maxFenceIndent);
    if (fence !== undefined) {
      if (!inFence) {
        inFence = true;
        fenceMarker = fence;
        return line; // the opening fence is code too — its info string matters
      }
      if (closesFence(line, fenceMarker, maxFenceIndent)) {
        inFence = false;
      }
      return line;
    }
    // Code is compared byte for byte wherever it sits: inside a fence at any
    // nesting, or indented four past the block's own indent, which is how an
    // indented code block is written both standalone and inside a list item.
    if (wholeBlockIsCode || inFence || indentWidth(line) >= contentMargin + 4) {
      return line;
    }
    // Prose: reflowing is not an edit, so whitespace within a line collapses.
    // Leading indentation and a two-space hard break are kept — the first says
    // what owns the line, the second is a `<br>`.
    const indent = /^[ \t]*/.exec(line)?.[0] ?? '';
    return (
      indent +
      line
        .replace(/[ \t]{2,}$/, HARD_BREAK)
        .replace(/[ \t]$/, '')
        .trim()
        .replace(/[ \t]+/g, ' ')
    );
  });

  // Prose lines join with a space — a soft wrap is not content. Code lines keep
  // their newline, because the line break is the program.
  let key = '';
  inFence = false;
  fenceMarker = '';
  for (let i = 0; i < normalized.length; i++) {
    const raw = lines[i] ?? '';
    const fence = fenceMarkerAt(raw, maxFenceIndent);
    const isCode =
      wholeBlockIsCode || inFence || fence !== undefined || indentWidth(raw) >= contentMargin + 4;
    if (fence !== undefined) {
      if (!inFence) {
        inFence = true;
        fenceMarker = fence;
      } else if (closesFence(raw, fenceMarker, maxFenceIndent)) {
        inFence = false;
      }
    }
    if (i > 0) {
      key += isCode || /\n$/.test(key) ? '\n' : ' ';
    }
    key += normalized[i] ?? '';
    if (isCode) {
      key += '\n';
    }
  }
  // No tidying pass here. Stripping whitespace before newlines would reach
  // inside the code that was just preserved line by line — trailing spaces in a
  // multiline string literal are part of its value. Prose lines are already
  // trimmed individually, so there is nothing left to tidy.
  return `${block.kind}:${key}`;
}

/**
 * The column a block's content starts at.
 *
 * For a list item that is past its marker and the spaces after it — `- x` has a
 * margin of two — because everything the item owns is measured from there. For
 * anything else it is simply the line's own indentation.
 *
 * Read from `block.text` rather than the key's working copy: an ordered marker
 * is stripped from that copy so renumbering does not read as a change, which
 * would leave the marker's width unaccounted for here.
 */
function contentMarginOf(block: MarkdownBlock): number {
  const first = block.text.split('\n')[0] ?? '';
  if (block.kind === 'listItem') {
    const marker = LIST_MARKER.exec(first);
    if (marker?.[0] !== undefined) {
      // The whole marker, not its leading whitespace: `- ` has no indent but
      // occupies two columns, and that is where the item's content begins.
      return columnsOf(marker[0]);
    }
  }
  return indentWidth(first);
}

/**
 * A line's indentation in **columns**, not characters.
 *
 * Markdown counts a tab as advancing to the next four-column stop, so a single
 * tab opens a code block on its own. Counting characters made tab-indented code
 * look like a one-column paragraph, and its string literals were normalised as
 * prose.
 */
const TAB_STOP = 4;
function indentWidth(line: string): number {
  return columnsOf(/^[ \t]*/.exec(line)?.[0] ?? '');
}

/** Columns a run of text occupies, with tabs advancing to the next tab stop. */
function columnsOf(text: string): number {
  let columns = 0;
  for (const char of text) {
    columns = char === '\t' ? columns + (TAB_STOP - (columns % TAB_STOP)) : columns + 1;
  }
  return columns;
}

/**
 * Diff two markdown documents. Within a changed region removals are emitted
 * before additions, so the old text reads above the new.
 */
export function diffMarkdown(before: string, after: string): DiffBlock[] {
  const oldBlocks = splitBlocks(before);
  const newBlocks = splitBlocks(after);

  // Past the budget, align nothing: report the old document as removed and the
  // new one as added. It is a worse diff, and it is honest — the alternative is
  // a 400 MB table on the extension host. What it must never do is claim
  // nothing changed, so the two sides are still compared for equality first.
  if ((oldBlocks.length + 1) * (newBlocks.length + 1) > DIFF_BUDGET_CELLS) {
    const identical =
      oldBlocks.length === newBlocks.length &&
      oldBlocks.every((block, i) => blockKey(block) === blockKey(newBlocks[i] as MarkdownBlock));
    if (identical) {
      return oldBlocks.map((block) => ({ op: 'same' as const, block }));
    }
    return [
      ...oldBlocks.map((block) => ({ op: 'del' as const, block })),
      ...newBlocks.map((block) => ({ op: 'add' as const, block })),
    ];
  }

  const common = lcs(oldBlocks.map(blockKey), newBlocks.map(blockKey));

  const out: DiffBlock[] = [];
  const emit = (op: DiffOp, block: MarkdownBlock | undefined): void => {
    // Indices come from lcs(), which only ever names positions that exist.
    if (block !== undefined) {
      out.push({ op, block });
    }
  };
  let o = 0;
  let n = 0;
  for (const [oi, ni] of common) {
    while (o < oi) {
      emit('del', oldBlocks[o++]);
    }
    while (n < ni) {
      emit('add', newBlocks[n++]);
    }
    emit('same', newBlocks[ni]);
    o = oi + 1;
    n = ni + 1;
  }
  while (o < oldBlocks.length) {
    emit('del', oldBlocks[o++]);
  }
  while (n < newBlocks.length) {
    emit('add', newBlocks[n++]);
  }
  return out;
}

/** True when any block in an already-computed diff was added or removed. */
export function hasChanges(blocks: DiffBlock[]): boolean {
  return blocks.some((b) => b.op !== 'same');
}

/**
 * Whether two documents differ at all. Answering yes/no needs no alignment, so
 * this compares normalized block keys in one pass rather than paying for the
 * LCS table {@link diffMarkdown} builds.
 */
export function hasMarkdownChanges(before: string, after: string): boolean {
  const keys = (source: string): string => splitBlocks(source).map(blockKey).join('\n');
  return keys(before) !== keys(after);
}

/** Collapse a diff into contiguous same-op runs for rendering. */
export function groupRuns(blocks: DiffBlock[]): DiffRun[] {
  const runs: DiffRun[] = [];
  for (const { op, block } of blocks) {
    const last = runs[runs.length - 1];
    if (last && last.op === op) {
      last.blocks.push(block);
    } else {
      runs.push({ op, blocks: [block] });
    }
  }
  return runs;
}

/**
 * Rejoin a run's blocks into one markdown fragment. Ordered-list markers are
 * rewritten to the item's position in the original list so numbering survives
 * a list being rendered in several pieces.
 */
export function runSource(run: DiffRun): string {
  const parts = run.blocks.map((block) =>
    block.ordinal === undefined
      ? block.text
      : // The ordinal is the number this item has in its own list — the start
        // the author wrote plus its position — so a run beginning mid-list
        // renders `<ol start="7">` rather than restarting at one.
        block.text.replace(
          ORDERED_MARKER,
          (_m, indent, _n, tail) => `${indent}${block.ordinal}${tail}`,
        ),
  );
  // Consecutive list items must stay adjacent or they render as separate lists.
  const allListItems = run.blocks.every((b) => b.kind === 'listItem');
  return parts.join(allListItems ? '\n' : '\n\n');
}

/**
 * Indices of a longest common subsequence, as `[oldIndex, newIndex]` pairs.
 * Classic O(n·m) dynamic program — block counts are in the hundreds, not the
 * millions, so the simple table beats a cleverer algorithm on readability.
 */
function lcs(a: string[], b: string[]): Array<[number, number]> {
  const width = b.length + 1;
  // One flat row-major array: `table[i * width + j]`. A nested array would need
  // an undefined check on every row lookup for no gain.
  const table = new Int32Array((a.length + 1) * width);
  const at = (i: number, j: number): number => table[i * width + j] as number;
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * width + j] =
        a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (at(i + 1, j) >= at(i, j + 1)) {
      i++;
    } else {
      j++;
    }
  }
  return pairs;
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

/**
 * Every `[label]: destination` definition in a document, as source lines.
 *
 * A reference link is resolved by the parser against definitions anywhere in
 * the same document. Rendering a diff run on its own therefore loses them: the
 * prose is in one run and its definitions in another, and `[manual][guide]`
 * falls back to literal text. Callers append these to each run so a run is
 * parsed with the context its side of the document had.
 *
 * Definitions inside fenced blocks are ignored; they are code, not links.
 */
export function referenceDefinitions(source: string): string[] {
  return scanDefinitions(source).definitions;
}

/**
 * Scan a fragment for reference definitions, returning them and whether
 * anything else was found.
 *
 * A definition may span lines: the destination can sit on the line after
 * `[label]:`, and a title after that. Matching only `[label]: <destination>` on
 * one line misses documents the renderer resolves perfectly well, which showed
 * up as a link rendering as literal text inside a diff.
 *
 * Definitions inside fenced blocks are ignored; they are code, not links.
 */
function scanDefinitions(source: string): { definitions: string[]; otherContent: boolean } {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const definitions: string[] = [];
  let otherContent = false;
  let inFence = false;
  let marker = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const fence = fenceMarkerAt(line);
    if (fence !== undefined) {
      if (!inFence) {
        inFence = true;
        marker = fence;
      } else if (closesFence(line, marker)) {
        inFence = false;
      }
      otherContent = true;
      continue;
    }
    if (inFence) {
      otherContent = true;
      continue;
    }
    if (line.trim() === '') {
      continue;
    }

    const label = DEFINITION_LABEL.exec(line);
    if (label === null) {
      otherContent = true;
      continue;
    }

    const parts = [line.trim()];
    let hasDestination = (label[1] ?? '').trim() !== '';
    // The destination, then optionally a title, may each be on their own line.
    while (!hasDestination && i + 1 < lines.length && (lines[i + 1] ?? '').trim() !== '') {
      parts.push((lines[++i] ?? '').trim());
      hasDestination = true;
    }
    if (i + 1 < lines.length && DEFINITION_TITLE.test(lines[i + 1] ?? '')) {
      parts.push((lines[++i] ?? '').trim());
    }
    definitions.push(parts.join('\n  '));
  }
  return { definitions, otherContent };
}

/**
 * Whether a fragment is nothing but reference definitions.
 *
 * Definitions render to no output at all — they configure the parser rather
 * than producing prose. So a run that is only definitions is invisible, and an
 * edit that changes only a link's destination shows the reader nothing. Callers
 * use this to render such a run explicitly instead.
 */
export function isReferenceDefinitionsOnly(source: string): boolean {
  const { definitions, otherContent } = scanDefinitions(source);
  return definitions.length > 0 && !otherContent;
}
