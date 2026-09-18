import {
  diffMarkdown,
  groupRuns,
  isReferenceDefinitionsOnly,
  referenceDefinitions,
  runSource,
} from '@repodoc/core';
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
 *
 * Every run is also given the reference definitions from the side of the
 * document it belongs to — removed runs the old ones, everything else the new.
 * A run is parsed alone, so without them `[manual][guide]` renders as literal
 * text the moment its definition lands in a different run. Definitions appended
 * this way produce no output of their own; they only resolve what is above.
 */
export function renderMarkdownDiff(
  before: string,
  after: string,
  options: { plantUmlServer?: string },
): DiffRenderResult {
  const blocks = diffMarkdown(before, after);
  const oldDefinitions = referenceDefinitions(before);
  const newDefinitions = referenceDefinitions(after);
  let hasMermaid = false;
  let added = 0;
  let removed = 0;

  const parts = groupRuns(blocks).map((run) => {
    if (run.op === 'add') {
      added += run.blocks.length;
    } else if (run.op === 'del') {
      removed += run.blocks.length;
    }
    const body = runSource(run);
    // A run of nothing but definitions renders to nothing: they configure the
    // parser, they are not prose. Shown as code so that changing only a link's
    // destination is something a reader can actually see.
    const visible =
      run.op !== 'same' && isReferenceDefinitionsOnly(body) ? '```\n' + body + '\n```' : body;
    const definitions = run.op === 'del' ? oldDefinitions : newDefinitions;
    const source = definitions.length ? `${visible}\n\n${definitions.join('\n')}` : visible;
    const rendered = renderMarkdownWithDiagrams(source, options);
    hasMermaid = hasMermaid || rendered.hasMermaid;
    if (run.op === 'same') {
      return rendered.html;
    }
    const label = run.op === 'add' ? 'added' : 'removed';
    return `<div class="diff-run diff-${run.op}" role="group" aria-label="${label}">${rendered.html}</div>`;
  });

  return { html: parts.join('\n'), hasMermaid, added, removed };
}
