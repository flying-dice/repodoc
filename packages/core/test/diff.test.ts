/**
 * The shape of a diff: what is compared, what is aligned, and what a caller is
 * handed to render.
 *
 * Structure comes from the reading view's own parser, so there are no tests
 * here for where a fence ends or which item owns a nested list — those are
 * Marked's answers, and asserting them again would be testing the library.
 * What is asserted is RepoDoc's part: the comparison policy, the alignment and
 * the runs.
 */

import { describe, test } from 'bun:test';
import * as assert from 'node:assert';
import { diffMarkdown, hasChanges, hasMarkdownChanges, lexMarkdown } from '../src/diff';
import { counts, projection, render, shape } from './diffHelpers';

describe('diff.lexMarkdown', () => {
  test('blank lines are separators, not blocks', () => {
    assert.deepStrictEqual(
      lexMarkdown('First para.\n\nSecond para.\n').tokens.map((t) => t.type),
      ['paragraph', 'paragraph'],
    );
  });

  test('a multi-line paragraph is one block', () => {
    assert.strictEqual(lexMarkdown('Line one\nline two\n').tokens.length, 1);
  });

  test('a whole list is one block, its items inside it', () => {
    const tokens = lexMarkdown('- alpha\n- beta\n- gamma\n').tokens;
    assert.deepStrictEqual(
      tokens.map((t) => t.type),
      ['list'],
    );
  });

  test('empty input yields no blocks', () => {
    assert.deepStrictEqual(lexMarkdown('').tokens, []);
    assert.deepStrictEqual(lexMarkdown('\n\n   \n').tokens, []);
  });

  test('CRLF input is normalized', () => {
    assert.deepStrictEqual(
      lexMarkdown('one\r\n\r\ntwo\r\n').tokens.map((t) => t.raw.trim()),
      ['one', 'two'],
    );
  });

  test('reference definitions are read as definitions, not as prose', () => {
    const doc = lexMarkdown('See [g][guide].\n\n[guide]: https://example.invalid "T"\n');
    assert.deepStrictEqual(doc.definitions, [
      { label: 'guide', href: 'https://example.invalid', title: 'T' },
    ]);
  });
});

describe('diff — the comparison policy', () => {
  test('reflowing a paragraph is not a change', () => {
    assert.strictEqual(hasMarkdownChanges('a   b', 'a\nb'), false);
  });

  test('a code payload is compared exactly', () => {
    assert.strictEqual(hasMarkdownChanges('```\na b\n```\n', '```\na  b\n```\n'), true);
  });

  test('inline code is compared exactly', () => {
    assert.strictEqual(hasMarkdownChanges('use `a b` here\n', 'use `a  b` here\n'), true);
  });

  test('a link destination is part of the content', () => {
    assert.strictEqual(
      hasMarkdownChanges('[text](https://a.invalid)\n', '[text](https://b.invalid)\n'),
      true,
    );
  });

  test('an image title is part of the content', () => {
    assert.strictEqual(hasMarkdownChanges('![a](x.png)\n', '![a](x.png "T")\n'), true);
  });

  test('heading depth is structure', () => {
    assert.strictEqual(hasMarkdownChanges('# Title\n', '## Title\n'), true);
  });

  test('a task checkbox state is structure', () => {
    assert.strictEqual(hasMarkdownChanges('- [ ] job\n', '- [x] job\n'), true);
  });

  test('table alignment is structure', () => {
    const left = '| a |\n| :-- |\n| 1 |\n';
    const right = '| a |\n| --: |\n| 1 |\n';
    assert.strictEqual(hasMarkdownChanges(left, right), true);
  });

  test('raw html is compared as written, not as prose', () => {
    assert.strictEqual(
      hasMarkdownChanges('<div data-x="1">\ntext\n</div>\n', '<div data-x="2">\ntext\n</div>\n'),
      true,
    );
  });

  test('a renumbered list that renders differently is a change', () => {
    // `<ol start="5">` and `<ol start="1">` are different documents.
    assert.strictEqual(hasMarkdownChanges('5. a\n6. b\n', '1. a\n2. b\n'), true);
  });

  test('a list renumbered into the same rendering is not a change', () => {
    // Markdown takes the numbering from the first marker, so both render 1, 2.
    assert.strictEqual(hasMarkdownChanges('1. a\n2. b\n', '1. a\n7. b\n'), false);
    assert.strictEqual(render('1. a\n2. b\n'), render('1. a\n7. b\n'));
  });
});

describe('diff.diffMarkdown', () => {
  test('identical documents are all unchanged', () => {
    const doc = '# Title\n\n- one\n- two\n';
    const diff = diffMarkdown(doc, doc);
    assert.ok(diff.runs.every((run) => run.op === 'same'));
    assert.strictEqual(hasChanges(diff), false);
  });

  test('a reworded paragraph reads as a removal then an addition, in place', () => {
    const before = 'keep\n\nold wording\n\ntail\n';
    const after = 'keep\n\nnew wording\n\ntail\n';
    assert.deepStrictEqual(shape(before, after), ['same', 'del', 'add', 'same']);
  });

  test('a reworded bullet replaces its whole list', () => {
    // The deliberate granularity: a list is one block, so one edited item marks
    // the list. Coarser than an item-level diff, and the item is still rendered
    // inside its own list, from its own tokens.
    const before = '- keep\n- old wording\n';
    const after = '- keep\n- new wording\n';
    assert.deepStrictEqual(shape(before, after), ['del', 'add']);
    assert.deepStrictEqual(counts(before, after), { added: 1, removed: 1 });
  });

  test('a purely inserted block produces no removal', () => {
    assert.deepStrictEqual(shape('one\n\nthree\n', 'one\n\ntwo\n\nthree\n'), [
      'same',
      'add',
      'same',
    ]);
  });

  test('a deleted block produces no addition', () => {
    assert.deepStrictEqual(shape('one\n\ntwo\n\nthree\n', 'one\n\nthree\n'), [
      'same',
      'del',
      'same',
    ]);
  });

  test('an empty baseline makes the whole document an addition', () => {
    assert.deepStrictEqual(shape('', '# New\n\nBody.\n'), ['add']);
  });

  test('an emptied document makes the whole baseline a removal', () => {
    assert.deepStrictEqual(shape('# Gone\n\nBody.\n', ''), ['del']);
  });

  test('moving a block reads as one removal and one addition', () => {
    assert.deepStrictEqual(shape('a\n\nb\n\nc\n', 'b\n\nc\n\na\n'), ['del', 'same', 'add']);
  });

  test('a changed fence is replaced whole, not line by line', () => {
    const before = '```ts\nconst a = 1;\nconst b = 2;\n```\n';
    const after = '```ts\nconst a = 1;\nconst b = 3;\n```\n';
    assert.deepStrictEqual(shape(before, after), ['del', 'add']);
  });

  test('removals come before additions, so the old text reads above the new', () => {
    const ops = diffMarkdown('old\n', 'new\n').runs.map((run) => run.op);
    assert.deepStrictEqual(ops, ['del', 'add']);
  });
});

describe('diff — runs carry their own side of the document', () => {
  test('a removed block renders as the old document rendered it', () => {
    const before = '1. one\n2. two\n3. three\n';
    const after = '1. one\n2. two changed\n3. three\n';
    assert.strictEqual(projection(before, after, 'old'), render(before));
    assert.strictEqual(projection(before, after, 'new'), render(after));
  });

  test('a run is rendered from tokens, never rebuilt from markdown', () => {
    const before = '- a\n';
    const after = '- a\n- b\n';
    const added = diffMarkdown(before, after).runs.find((run) => run.op === 'add');
    assert.ok(added !== undefined);
    assert.strictEqual(added.tokens[0]?.type, 'list');
  });
});
