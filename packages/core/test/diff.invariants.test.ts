/**
 * The acceptance criteria for the diff, as invariants rather than examples.
 *
 * A higher test count proved nothing about the classifier this replaced: each
 * round of fixes passed its own cases and broke the next document. These three
 * properties are what the diff is actually for, and the oracle for every one of
 * them is the ordinary reading view — the same parser rendering the document a
 * reader sees, never the comparison key being tested.
 *
 *  - **Preservation** — projecting the comparison onto either side reproduces
 *    that side's ordinary rendering, annotations aside.
 *  - **Detection** — changing a code payload is never reported as unchanged.
 *  - **Controlled equivalence** — approved prose reflow stays a non-change,
 *    while hard breaks, code payloads and attributes stay distinguishable.
 *
 * The generated cases combine nesting, tabs, headings, paragraphs and code,
 * and fast-check shrinks any failure to a small reproducible document.
 */

import { describe, test } from 'bun:test';
import * as assert from 'node:assert';
import fc from 'fast-check';
import { definitionSource, hasMarkdownChanges, lexMarkdown } from '../src/diff';
import { codePayloads, projection, render, renderingIdentity } from './diffHelpers';

/** A block of markdown, and the body it is built from. */
const block = fc.oneof(
  fc.constantFrom(
    'plain paragraph text',
    'wrapped paragraph\ncontinued on the next line',
    '# Heading one',
    '### Heading three',
    'Setext title\n============',
    '---',
    '> quoted prose\n>\n> ```js\n> const s = "a b";\n> ```',
    '- bullet\n- second bullet',
    '- outer\n\n  - inner\n  continued\n\n      ```js\n    const s = "a b";\n      ```',
    '- outer\n\n      - name: "a b"',
    '1. first\n2. second',
    '5. five\n6. six',
    '- [ ] open task\n- [x] done task',
    '```yaml\nroot:\n  child: 1\n```',
    '\tconst s = "a b";',
    '    const s = "a b";',
    '    ```\n    literal ticks\n    ```',
    '| a | b |\n| --- | --- |\n| 1 | 2 |',
    'Read [manual][guide].',
    'hard  \nbreak',
    '<div data-x="1">\nraw\n</div>',
  ),
);

/** A document of one to six blocks, sometimes with a definition at the foot. */
const document = fc
  .tuple(fc.array(block, { minLength: 1, maxLength: 6 }), fc.boolean())
  .map(([blocks, withDefinition]) =>
    [...blocks, ...(withDefinition ? ['[guide]: https://example.invalid/a "T"'] : [])].join('\n\n'),
  );

/**
 * Two spellings of one block that a reader cannot tell apart: reflowed prose,
 * respaced markers, a renumbered list that still renders from the same start.
 */
const equivalentPair = fc.constantFrom<[string, string]>(
  ['plain paragraph text', 'plain\nparagraph     text'],
  ['wrapped paragraph\ncontinued on the next line', 'wrapped paragraph continued on the next line'],
  ['# Heading one', '#  Heading one'],
  ['- bullet\n- second bullet', '-   bullet\n-   second bullet'],
  ['1. first\n2. second', '1. first\n7. second'],
  ['```yaml\nroot:\n  child: 1\n```', '```yaml\nroot:\n  child: 1\n```'],
  ['    const s = "a b";', '    const s = "a b";'],
  ['| a | b |\n| --- | --- |\n| 1 | 2 |', '| a  |  b |\n| --- | --- |\n| 1 | 2 |'],
);

/**
 * A document, or the same document respelled block by block into something a
 * reader cannot tell apart. Preservation has to hold across *matched* blocks,
 * and blocks only match when they are equivalent without being identical —
 * generating documents from fixed blocks alone never produces that case.
 */
const documentOrReflow = fc
  .tuple(
    fc.array(
      fc.oneof(
        block,
        equivalentPair.map(([, b]) => b),
      ),
      { minLength: 1, maxLength: 6 },
    ),
  )
  .map(([blocks]) => blocks.join('\n\nseparator\n\n'));

/** A document's reference definitions, as the parser resolved them. */
function definitions(source: string): string {
  return definitionSource(lexMarkdown(source).definitions);
}

describe('diff — preservation', () => {
  test('projecting a comparison onto either side reproduces that side', () => {
    fc.assert(
      fc.property(documentOrReflow, documentOrReflow, (before, after) => {
        assert.strictEqual(projection(before, after, 'old'), render(before));
        assert.strictEqual(projection(before, after, 'new'), render(after));
      }),
      { numRuns: 400 },
    );
  });

  test('an unchanged document projects to itself on both sides', () => {
    fc.assert(
      fc.property(document, (doc) => {
        assert.strictEqual(projection(doc, doc, 'old'), render(doc));
        assert.strictEqual(hasMarkdownChanges(doc, doc), false);
      }),
      { numRuns: 400 },
    );
  });
});

describe('diff — detection', () => {
  test('a changed code payload is never reported as unchanged', () => {
    const edits: Array<[string, string]> = [
      ['"a b"', '"a  b"'],
      ['child: 1', 'child:  1'],
      ['literal ticks', 'literal  ticks'],
    ];
    fc.assert(
      fc.property(document, fc.constantFrom(...edits), (doc, [from, to]) => {
        const edited = doc.replace(from, to);
        // The parser decides what is code. An edit inside a list item's
        // continuation paragraph is prose however much it looks like code, and
        // respacing prose is a permitted equivalence rather than a miss.
        fc.pre(codePayloads(render(doc)).join('|') !== codePayloads(render(edited)).join('|'));
        assert.strictEqual(
          hasMarkdownChanges(doc, edited),
          true,
          `a code payload edit went unreported:\n${doc}`,
        );
      }),
      { numRuns: 400 },
    );
  });

  test('any document a reader would see differently is reported as changed', () => {
    fc.assert(
      fc.property(document, document, (before, after) => {
        fc.pre(renderingIdentity(before) !== renderingIdentity(after));
        assert.strictEqual(hasMarkdownChanges(before, after), true);
      }),
      { numRuns: 400 },
    );
  });

  test('documents a reader would see identically are not reported as changed', () => {
    // Built as pairs rather than drawn independently: two random documents
    // almost never render the same, so a precondition would reject nearly
    // every case and prove nothing.
    fc.assert(
      fc.property(fc.array(equivalentPair, { minLength: 1, maxLength: 6 }), (pairs) => {
        // Separated by an unindented paragraph, which closes any list above
        // it. Without that, respacing a marker changes the content margin
        // and the block below it stops being code — a real difference, not
        // an equivalence, and nothing to do with the diff.
        const before = pairs.map(([a]) => a).join('\n\nseparator\n\n');
        const after = pairs.map(([, b]) => b).join('\n\nseparator\n\n');
        assert.strictEqual(
          renderingIdentity(before),
          renderingIdentity(after),
          'the pairs must be equivalent to a reader for this to mean anything',
        );
        assert.strictEqual(definitions(before), definitions(after));
        assert.strictEqual(hasMarkdownChanges(before, after), false);
        // Equivalent is not identical. A matched run must still be able to
        // show the old side as the old side actually was, or a diff of a
        // reflowed document reconstructs a document nobody wrote.
        assert.strictEqual(projection(before, after, 'old'), render(before));
        assert.strictEqual(projection(before, after, 'new'), render(after));
      }),
      { numRuns: 400 },
    );
  });
});

describe('diff — controlled equivalence', () => {
  test('reflowing prose around any document is not a change', () => {
    fc.assert(
      fc.property(document, (doc) => {
        const reflowed = doc.replace('plain paragraph text', 'plain\nparagraph    text');
        fc.pre(reflowed !== doc);
        assert.strictEqual(hasMarkdownChanges(doc, reflowed), false);
      }),
      { numRuns: 300 },
    );
  });

  test('removing a hard break is always a change', () => {
    fc.assert(
      fc.property(document, (doc) => {
        fc.pre(doc.includes('hard  \nbreak'));
        assert.strictEqual(hasMarkdownChanges(doc, doc.replace('hard  \n', 'hard\n')), true);
      }),
      { numRuns: 300 },
    );
  });

  test('repointing a reference definition is always a change, used or not', () => {
    fc.assert(
      fc.property(document, (doc) => {
        fc.pre(doc.includes('[guide]:'));
        assert.strictEqual(
          hasMarkdownChanges(doc, doc.replace('/a "T"', '/b "T"')),
          true,
          'a definition renders to nothing, so this edit is invisible unless reported',
        );
      }),
      { numRuns: 300 },
    );
  });

  test('an unused definition change is still reported', () => {
    const before = 'prose only\n\n[unused]: https://example.invalid/a\n';
    assert.strictEqual(hasMarkdownChanges(before, before.replace('/a', '/b')), true);
  });
});
