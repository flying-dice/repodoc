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

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
/** Stands for a markdown hard break while prose whitespace is collapsed. */
const HARD_BREAK = '\u0000';
const LIST_MARKER = /^(\s*)([-*+]|\d+[.)])\s+/;
const ORDERED_MARKER = /^(\s*)(\d+)([.)]\s+)/;
/** `[label]: destination "optional title"` at the head of a line. */
const REFERENCE_DEFINITION = /^ {0,3}\[[^\]]+\]:\s*\S/;

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
    const marker = FENCE_OPEN.exec(at(i))?.[1] ?? '```';
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

    if (FENCE_OPEN.test(at(i))) {
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
    while (i < lines.length && at(i).trim() !== '' && !FENCE_OPEN.test(at(i))) {
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
  const baseIndent = (opening[1] ?? '').length;
  const ordered = ORDERED_MARKER.test(at(from));
  const start = ordered ? Number(ORDERED_MARKER.exec(at(from))?.[2] ?? 1) : 0;

  /** Indented past the marker, so it belongs to the item above. */
  const isContinuation = (line: string): boolean =>
    line.trim() !== '' && (/^[ \t]*/.exec(line)?.[0].length ?? 0) > baseIndent;

  let i = from;
  let position = 0;
  while (i < lines.length) {
    const marker = LIST_MARKER.exec(at(i));
    const startsItem = marker !== null && (marker[1] ?? '').length <= baseIndent;
    if (!startsItem) {
      break;
    }
    // A list of one kind does not continue into another.
    if (ORDERED_MARKER.test(at(i)) !== ordered) {
      break;
    }

    const itemFrom = i;
    i++;
    // Everything indented under the marker, blank lines included while more
    // indented content follows.
    for (;;) {
      if (i < lines.length && isContinuation(at(i))) {
        i++;
        continue;
      }
      if (i < lines.length && at(i).trim() === '') {
        // A blank line only ends the item when nothing indented follows it.
        let lookahead = i;
        while (lookahead < lines.length && at(lookahead).trim() === '') {
          lookahead++;
        }
        if (lookahead < lines.length && isContinuation(at(lookahead))) {
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
      const next = (() => {
        let k = i;
        while (k < lines.length && at(k).trim() === '') {
          k++;
        }
        return k;
      })();
      const following = LIST_MARKER.exec(at(next));
      const continues =
        following !== null &&
        (following[1] ?? '').length <= baseIndent &&
        ORDERED_MARKER.test(at(next)) === ordered;
      if (!continues) {
        break;
      }
      i = next;
    }
  }
  return i;
}

function closesFence(line: string, marker: string): boolean {
  const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
  const fence = close?.[1];
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
  if (block.kind === 'fence') {
    return `fence:${source}`;
  }
  // Leading indentation of the block decides what it is — four spaces make a
  // code block, and a continuation belongs to the item it sits under.
  const indent = /^[ \t]*/.exec(source)?.[0] ?? '';
  const withBreaks = source
    .split('\n')
    // Two or more trailing spaces are a hard break. Marked before the join, or
    // the collapse below would eat them like any other run.
    .map((line) => line.replace(/[ \t]{2,}$/, HARD_BREAK).replace(/[ \t]$/, ''))
    .join(' ');
  return `${block.kind}:${indent}${withBreaks.replace(/[ \t]+/g, ' ').trim()}`;
}

/**
 * Diff two markdown documents. Within a changed region removals are emitted
 * before additions, so the old text reads above the new.
 */
export function diffMarkdown(before: string, after: string): DiffBlock[] {
  const oldBlocks = splitBlocks(before);
  const newBlocks = splitBlocks(after);
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
  const definitions: string[] = [];
  let inFence = false;
  let marker = '';
  for (const line of source.replace(/\r\n?/g, '\n').split('\n')) {
    const fence = FENCE_OPEN.exec(line)?.[1];
    if (fence !== undefined) {
      if (!inFence) {
        inFence = true;
        marker = fence;
      } else if (closesFence(line, marker)) {
        inFence = false;
      }
      continue;
    }
    if (inFence) {
      continue;
    }
    if (REFERENCE_DEFINITION.test(line)) {
      definitions.push(line.trim());
    }
  }
  return definitions;
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
  const lines = source
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((line) => line.trim() !== '');
  return lines.length > 0 && lines.every((line) => REFERENCE_DEFINITION.test(line));
}
