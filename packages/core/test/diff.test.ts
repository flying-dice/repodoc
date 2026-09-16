import { describe, test } from 'bun:test';
import * as assert from 'node:assert';
import type { DiffBlock } from '../src/diff';
import { blockKey, diffMarkdown, groupRuns, hasChanges, runSource, splitBlocks } from '../src/diff';
import { required } from './helpers';

/** Compact rendering of a diff for assertions: `+`/`-`/` ` then the first line. */
function shape(blocks: DiffBlock[]): string[] {
  const sign = { same: ' ', add: '+', del: '-' } as const;
  return blocks.map((b) => `${sign[b.op]}${b.block.text.split('\n')[0]}`);
}

describe('diff.splitBlocks', () => {
  test('paragraphs separated by blank lines are separate blocks', () => {
    const blocks = splitBlocks('First para.\n\nSecond para.\n');
    assert.deepStrictEqual(
      blocks.map((b) => b.text),
      ['First para.', 'Second para.'],
    );
  });

  test('a multi-line paragraph stays one block', () => {
    const blocks = splitBlocks('Line one\nline two\n');
    assert.strictEqual(blocks.length, 1);
    assert.strictEqual(required(blocks[0], 'block').text, 'Line one\nline two');
  });

  test('each list item is its own block', () => {
    const blocks = splitBlocks('- alpha\n- beta\n- gamma\n');
    assert.deepStrictEqual(
      blocks.map((b) => b.text),
      ['- alpha', '- beta', '- gamma'],
    );
    assert.ok(blocks.every((b) => b.kind === 'listItem'));
  });

  test('continuation lines and nested items stay with their item', () => {
    const blocks = splitBlocks('- alpha\n  wrapped text\n  - nested\n- beta\n');
    assert.deepStrictEqual(
      blocks.map((b) => b.text),
      ['- alpha\n  wrapped text\n  - nested', '- beta'],
    );
  });

  test('ordered list items carry their position', () => {
    const blocks = splitBlocks('1. one\n2. two\n3. three\n');
    assert.deepStrictEqual(
      blocks.map((b) => b.ordinal),
      [1, 2, 3],
    );
  });

  test('a fenced block is atomic, blank lines and markers inside included', () => {
    const source = 'intro\n\n```ts\nconst a = 1;\n\n- not a list\n```\n\nouttro\n';
    const blocks = splitBlocks(source);
    assert.deepStrictEqual(
      blocks.map((b) => b.kind),
      ['prose', 'fence', 'prose'],
    );
    assert.strictEqual(
      required(blocks[1], 'block').text,
      '```ts\nconst a = 1;\n\n- not a list\n```',
    );
  });

  test('an unterminated fence runs to the end of the document', () => {
    const blocks = splitBlocks('```\nunclosed\n');
    assert.strictEqual(blocks.length, 1);
    assert.strictEqual(required(blocks[0], 'block').kind, 'fence');
    assert.strictEqual(required(blocks[0], 'block').text, '```\nunclosed');
  });

  test('a fence closes only on a matching marker of at least equal length', () => {
    const blocks = splitBlocks('````\n```\nstill inside\n````\n');
    assert.strictEqual(blocks.length, 1);
    assert.strictEqual(required(blocks[0], 'block').text, '````\n```\nstill inside\n````');
  });

  test('a fence immediately after a paragraph ends the paragraph', () => {
    const blocks = splitBlocks('para\n```\ncode\n```\n');
    assert.deepStrictEqual(
      blocks.map((b) => b.kind),
      ['prose', 'fence'],
    );
  });

  test('empty input yields no blocks', () => {
    assert.deepStrictEqual(splitBlocks(''), []);
    assert.deepStrictEqual(splitBlocks('\n\n   \n'), []);
  });

  test('CRLF input is normalized', () => {
    const blocks = splitBlocks('one\r\n\r\ntwo\r\n');
    assert.deepStrictEqual(
      blocks.map((b) => b.text),
      ['one', 'two'],
    );
  });
});

describe('diff.blockKey', () => {
  test('whitespace runs collapse so reflowing is not a change', () => {
    const a = required(splitBlocks('a   b')[0], 'block');
    const b = required(splitBlocks('a\nb')[0], 'block');
    assert.strictEqual(blockKey(a), blockKey(b));
  });

  test('renumbering an ordered list is not a change', () => {
    const a = required(splitBlocks('3. same text')[0], 'block');
    const b = required(splitBlocks('7. same text')[0], 'block');
    assert.strictEqual(blockKey(a), blockKey(b));
  });

  test('blocks of different kinds never match', () => {
    const a = required(splitBlocks('- text')[0], 'block');
    const b = required(splitBlocks('text')[0], 'block');
    assert.notStrictEqual(blockKey(a), blockKey(b));
  });
});

describe('diff.diffMarkdown', () => {
  test('identical documents are all unchanged', () => {
    const doc = '# Title\n\n- one\n- two\n';
    const blocks = diffMarkdown(doc, doc);
    assert.ok(blocks.every((b) => b.op === 'same'));
    assert.strictEqual(hasChanges(blocks), false);
  });

  test('a reworded bullet reads as a removal then an addition, in place', () => {
    const before = '- keep\n- old wording\n- tail\n';
    const after = '- keep\n- new wording\n- tail\n';
    assert.deepStrictEqual(shape(diffMarkdown(before, after)), [
      ' - keep',
      '-- old wording',
      '+- new wording',
      ' - tail',
    ]);
  });

  test('a purely inserted bullet produces no removal', () => {
    const before = '- one\n- three\n';
    const after = '- one\n- two\n- three\n';
    assert.deepStrictEqual(shape(diffMarkdown(before, after)), [' - one', '+- two', ' - three']);
  });

  test('a deleted bullet produces no addition', () => {
    const blocks = diffMarkdown('- one\n- two\n- three\n', '- one\n- three\n');
    assert.deepStrictEqual(shape(blocks), [' - one', '-- two', ' - three']);
  });

  test('an empty baseline makes the whole document an addition', () => {
    const blocks = diffMarkdown('', '# New\n\nBody.\n');
    assert.deepStrictEqual(shape(blocks), ['+# New', '+Body.']);
  });

  test('an emptied document makes the whole baseline a removal', () => {
    const blocks = diffMarkdown('# Gone\n\nBody.\n', '');
    assert.deepStrictEqual(shape(blocks), ['-# Gone', '-Body.']);
  });

  test('moving a block reads as one removal and one addition', () => {
    const blocks = diffMarkdown('- a\n- b\n- c\n', '- b\n- c\n- a\n');
    assert.deepStrictEqual(shape(blocks), ['-- a', ' - b', ' - c', '+- a']);
  });

  test('a changed fence is replaced whole, not line by line', () => {
    const before = '```ts\nconst a = 1;\nconst b = 2;\n```\n';
    const after = '```ts\nconst a = 1;\nconst b = 3;\n```\n';
    const blocks = diffMarkdown(before, after);
    assert.deepStrictEqual(
      blocks.map((b) => b.op),
      ['del', 'add'],
    );
  });
});

describe('diff.groupRuns and runSource', () => {
  test('contiguous blocks of one op collapse into a single run', () => {
    const runs = groupRuns(diffMarkdown('- a\n', '- a\n- b\n- c\n'));
    assert.deepStrictEqual(
      runs.map((r) => [r.op, r.blocks.length]),
      [
        ['same', 1],
        ['add', 2],
      ],
    );
  });

  test('a run of list items rejoins without blank lines so it stays one list', () => {
    const runs = groupRuns(diffMarkdown('', '- a\n- b\n'));
    assert.strictEqual(runSource(required(runs[0], 'run')), '- a\n- b');
  });

  test('a run of paragraphs rejoins with blank lines', () => {
    const runs = groupRuns(diffMarkdown('', 'one\n\ntwo\n'));
    assert.strictEqual(runSource(required(runs[0], 'run')), 'one\n\ntwo');
  });

  test('ordered numbering is restored when a list renders in pieces', () => {
    const before = '1. one\n2. two\n3. three\n';
    const after = '1. one\n2. changed\n3. three\n';
    const runs = groupRuns(diffMarkdown(before, after));
    const tail = required(runs[runs.length - 1], 'last run');
    assert.strictEqual(tail.op, 'same');
    // The trailing item keeps its original position rather than restarting.
    assert.strictEqual(runSource(tail), '3. three');
  });
});
