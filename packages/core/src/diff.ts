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
const LIST_MARKER = /^(\s*)([-*+]|\d+[.)])\s+/;
const ORDERED_MARKER = /^(\s*)(\d+)([.)]\s+)/;

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

  while (i < lines.length) {
    if (at(i).trim() === '') {
      i++;
      continue;
    }

    const marker = FENCE_OPEN.exec(at(i))?.[1];
    if (marker !== undefined) {
      const start = i;
      i++;
      while (i < lines.length && !closesFence(at(i), marker)) {
        i++;
      }
      if (i < lines.length) {
        i++; // consume the closing fence
      }
      // An unterminated fence swallows the rest of the file, trailing blank
      // lines included; they are not part of the code.
      const text = lines.slice(start, i).join('\n').replace(/\n+$/, '');
      blocks.push({ text, kind: 'fence' });
      continue;
    }

    // A group runs to the next blank line or fence.
    const start = i;
    while (i < lines.length && at(i).trim() !== '' && !FENCE_OPEN.test(at(i))) {
      i++;
    }
    const group = lines.slice(start, i);
    if (LIST_MARKER.test(group[0] ?? '')) {
      blocks.push(...splitListItems(group));
    } else {
      blocks.push({ text: group.join('\n'), kind: 'prose' });
    }
  }

  return blocks;
}

/**
 * Split a list group into one block per item. Continuation lines and nested
 * items (indented past the top-level marker) stay with the item they belong to.
 */
function splitListItems(group: string[]): MarkdownBlock[] {
  // Callers only reach here when the first line matched LIST_MARKER.
  const baseIndent = LIST_MARKER.exec(group[0] ?? '')?.[1]?.length ?? 0;
  const items: string[][] = [];
  for (const line of group) {
    const indent = LIST_MARKER.exec(line)?.[1];
    const startsItem = indent !== undefined && indent.length <= baseIndent;
    const current = items[items.length - 1];
    if (startsItem || current === undefined) {
      items.push([line]);
    } else {
      current.push(line);
    }
  }
  let ordinal = 0;
  return items.map((item) => {
    const ordered = ORDERED_MARKER.test(item[0] ?? '');
    if (ordered) {
      ordinal++;
    }
    return {
      text: item.join('\n'),
      kind: 'listItem' as const,
      ...(ordered ? { ordinal } : {}),
    };
  });
}

function closesFence(line: string, marker: string): boolean {
  const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
  const fence = close?.[1];
  return fence !== undefined && fence[0] === marker[0] && fence.length >= marker.length;
}

/**
 * Identity used for matching blocks across the two sides. Whitespace runs
 * collapse, and an ordered-list marker's number is dropped so that a list
 * renumbering does not read as every item having changed.
 */
export function blockKey(block: MarkdownBlock): string {
  const text = block.ordinal === undefined ? block.text : block.text.replace(ORDERED_MARKER, '$1');
  return `${block.kind}:${text.replace(/\s+/g, ' ').trim()}`;
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
      : block.text.replace(
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
