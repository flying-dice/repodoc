import { diffMarkdown, groupRuns, runSource } from '@repodoc/core';
import { renderMarkdownWithDiagrams } from './diagrams';

export interface DiffRenderResult {
  html: string;
  hasMermaid: boolean;
  /** Blocks added and removed, for the legend counts. */
  added: number;
  removed: number;
}

/**
 * Render a `HEAD → working tree` diff as reading-view HTML: the whole document
 * in order, with added and removed blocks wrapped in marker elements the
 * stylesheet colours.
 *
 * Each run of same-op blocks is rendered in one pass rather than block by
 * block, so lists and their numbering survive the split.
 */
export function renderMarkdownDiff(
  before: string,
  after: string,
  options: { plantUmlServer?: string },
): DiffRenderResult {
  const blocks = diffMarkdown(before, after);
  let hasMermaid = false;
  let added = 0;
  let removed = 0;

  const parts = groupRuns(blocks).map((run) => {
    if (run.op === 'add') {
      added += run.blocks.length;
    } else if (run.op === 'del') {
      removed += run.blocks.length;
    }
    const rendered = renderMarkdownWithDiagrams(runSource(run), options);
    hasMermaid = hasMermaid || rendered.hasMermaid;
    if (run.op === 'same') {
      return rendered.html;
    }
    const label = run.op === 'add' ? 'added' : 'removed';
    return `<div class="diff-run diff-${run.op}" role="group" aria-label="${label}">${rendered.html}</div>`;
  });

  return { html: parts.join('\n'), hasMermaid, added, removed };
}
