import {
  type DefinitionChange,
  type DiffRun,
  definitionSource,
  diffMarkdown,
} from '@repodoc/core/diff';
import { renderMarkdownWithDiagrams, renderTokensWithDiagrams } from './diagrams';

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
 * Each run is rendered from the tokens of its own side of the document, so a
 * removed block reads as the old document read and an added one as the new.
 * Nothing is re-serialised to markdown and re-parsed on the way — lists keep
 * their numbering, nested content keeps its parent, and no fragment gets a
 * second, different interpretation.
 *
 * One comparison drives both the markers and the counts; they cannot disagree
 * about whether the document changed.
 */
export function renderMarkdownDiff(
  before: string,
  after: string,
  options: { plantUmlServer?: string },
): DiffRenderResult {
  const diff = diffMarkdown(before, after);
  let hasMermaid = false;

  const parts = diff.runs.map((run: DiffRun) => {
    const rendered = renderTokensWithDiagrams(run.tokens, options);
    hasMermaid = hasMermaid || rendered.hasMermaid;
    return run.op === 'same' ? rendered.html : wrap(run.op, rendered.html);
  });

  parts.push(...definitionParts(diff.definitions, options));

  return { html: parts.join('\n'), hasMermaid, added: diff.added, removed: diff.removed };
}

/**
 * Reference definitions render to no output at all — they configure the parser
 * rather than producing prose — so a changed destination is invisible in the
 * document itself. Changed definitions are listed as source instead, including
 * ones nothing currently links to: an edit that the reader cannot see must
 * still be reported.
 */
function definitionParts(change: DefinitionChange, options: { plantUmlServer?: string }): string[] {
  const listing = (op: 'add' | 'del', source: string): string =>
    wrap(op, renderMarkdownWithDiagrams(`\`\`\`\n${source}\n\`\`\``, options).html);

  const parts: string[] = [];
  if (change.removed.length > 0) {
    parts.push(listing('del', definitionSource(change.removed)));
  }
  if (change.added.length > 0) {
    parts.push(listing('add', definitionSource(change.added)));
  }
  return parts;
}

function wrap(op: 'add' | 'del', html: string): string {
  const label = op === 'add' ? 'added' : 'removed';
  return `<div class="diff-run diff-${op}" role="group" aria-label="${label}">${html}</div>`;
}
