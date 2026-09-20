/**
 * Shared test tooling for the markdown diff.
 *
 * The oracle for every assertion here is the ordinary reading view: the same
 * parser, the same options, rendering the document as a reader would see it.
 * Asserting against the diff's own comparison key would only prove that a
 * function agrees with itself.
 */

import { Marked } from 'marked';
import { diffMarkdown, MARKDOWN_OPTIONS } from '../src/diff';

const marked = new Marked(MARKDOWN_OPTIONS);

/** A document rendered the ordinary way — the reading view's own output. */
export function render(source: string): string {
  return marked.parse(source) as string;
}

/**
 * One side of a diff, rendered from the tokens the diff kept for it: the same
 * blocks a reader would see on that side, with the other side's blocks left
 * out.
 *
 * `render(document) === projection(…, side)` is the preservation invariant —
 * the diff may annotate a document, never reinterpret it.
 */
export function projection(before: string, after: string, side: 'old' | 'new'): string {
  const wanted = side === 'old' ? 'del' : 'add';
  const tokens = diffMarkdown(before, after)
    .runs.filter((run) => run.op === 'same' || run.op === wanted)
    .flatMap((run) => run.tokens);
  return marked.parser(tokens);
}

/** Blocks reported added and removed, definition changes included. */
export function counts(before: string, after: string): { added: number; removed: number } {
  const diff = diffMarkdown(before, after);
  return { added: diff.added, removed: diff.removed };
}

/** The ops of a diff in order, for asserting shape without asserting content. */
export function shape(before: string, after: string): string[] {
  return diffMarkdown(before, after).runs.map((run) => run.op);
}

/**
 * What a reader actually sees, as a comparable string.
 *
 * HTML collapses runs of whitespace when it is displayed, so two renderings
 * that differ only in prose spacing look identical — which is precisely the
 * equivalence the diff is allowed to permit. Code payloads are exempt: inside
 * `<pre>` and `<code>` the whitespace is the content, so they are appended
 * unmodified.
 *
 * This is the oracle for the detection property, derived from the reading
 * view's own output rather than from the comparison under test.
 */
export function renderingIdentity(source: string): string {
  const html = render(source);
  return `${html.replace(/\s+/g, ' ').trim()} ${codePayloads(html).join(' ')}`;
}

/** The contents of every code element in a rendering, byte for byte. */
export function codePayloads(html: string): string[] {
  return [...html.matchAll(/<code[^>]*>([\s\S]*?)<\/code>/g)].map((m) => m[1] ?? '');
}
