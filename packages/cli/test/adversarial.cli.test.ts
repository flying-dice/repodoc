/**
 * Adversarial coverage for the CLI: every command's failure paths, the shape of
 * `--json`, empty strings, unicode, out-of-range indices, whitespace-only
 * reasons, and a `--root` that is not a directory.
 *
 * Assertions look at the FILES the CLI wrote (and at exit codes), not only at
 * stdout — a command that prints success while corrupting a card is the failure
 * mode worth catching.
 *
 * `test.skip` marks a failing test for a defect reported to the lead; the
 * assertion states the contract, never the current behaviour.
 */

import { afterEach, beforeEach, describe, test } from 'bun:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseArgs } from '../src/args';
import { runCli } from '../src/cli';

let root: string;

interface Result {
  code: number;
  out: string;
  err: string;
}

/** Runs the CLI in-process against the temp root with a fixed author. */
function run(...argv: string[]): Result {
  let out = '';
  let err = '';
  const code = runCli(['--root', root, '--who', 'tester', ...argv], root, {
    stdout: (s) => {
      out += s;
    },
    stderr: (s) => {
      err += s;
    },
  });
  return { code, out, err };
}

function json(...argv: string[]): unknown {
  const r = run(...argv, '--json');
  assert.strictEqual(r.code, 0, r.err);
  return JSON.parse(r.out);
}

const BOARD = 'project-backlog';
const boardDir = (): string => path.join(root, 'boards', BOARD);

function cardFiles(): string[] {
  return fs
    .readdirSync(boardDir())
    .filter((n) => n.endsWith('.md'))
    .sort();
}

/** The file backing a card slug, whatever number prefix it currently has. */
function readCard(slug: string): string {
  const name = cardFiles().find((n) => n.replace(/^\d+-/, '').replace(/\.md$/, '') === slug);
  assert.ok(name, `a file for card "${slug}" should exist, saw ${cardFiles().join(', ')}`);
  return fs.readFileSync(path.join(boardDir(), name), 'utf8');
}

/** Writes a board config with gates and one custom field of every type. */
function writeConfig(): void {
  fs.writeFileSync(
    path.join(boardDir(), '.config.json'),
    JSON.stringify(
      {
        name: 'Project Backlog',
        columns: [
          { id: 'backlog', name: 'Backlog', color: '#7d828b' },
          { id: 'todo', name: 'To Do', color: '#4c8bf5' },
          {
            id: 'done',
            name: 'Done',
            color: '#3fb27f',
            prompt: '  Tell the reporter.  ',
            enter: [
              {
                id: 'signoff',
                label: 'Approved',
                field: 'approved',
                check: '= true',
                prompt: 'Ask a human to approve.',
              },
            ],
          },
        ],
        labels: {},
        fields: [
          { id: 'note', type: 'text' },
          { id: 'count', type: 'number' },
          { id: 'approved', type: 'boolean' },
          { id: 'due', type: 'date' },
          { id: 'size', type: 'select', options: ['S', 'M'] },
          { id: 'tags', type: 'multiselect', options: ['a', 'b'] },
        ],
      },
      null,
      2,
    ),
  );
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'repodoc-adv-cli-'));
  run('init');
  writeConfig();
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('parseArgs — adversarial', () => {
  test('given a negative flag value, when parsed, then it is a value and not a new flag', () => {
    assert.deepStrictEqual(parseArgs(['--index', '-1']).flags, { index: '-1' });
    assert.deepStrictEqual(parseArgs(['--index=-1']).flags, { index: '-1' });
  });

  test('given a flag followed by another flag, when parsed, then the first is a bare boolean', () => {
    assert.deepStrictEqual(parseArgs(['--title', '--json']).flags, { title: true, json: true });
  });

  test('given an empty value, when parsed, then the empty string is preserved', () => {
    assert.deepStrictEqual(parseArgs(['--reason=']).flags, { reason: '' });
    assert.deepStrictEqual(parseArgs(['--reason', '']).flags, { reason: '' });
    assert.deepStrictEqual(parseArgs(['--reason', '']).positionals, []);
  });

  test('given a -- terminator, when parsed, then later dashed values are positionals', () => {
    const parsed = parseArgs(['card', 'set', '--', '--weird-value']);
    assert.deepStrictEqual(parsed.positionals, ['card', 'set', '--weird-value']);
  });

  test('given --no-x, when parsed, then x is false (so a real "no-" flag is unreachable)', () => {
    assert.deepStrictEqual(parseArgs(['--no-cache']).flags, { cache: false });
  });
});

describe('repodoc card create / update — adversarial', () => {
  test('given a title with no ASCII letters, when created, then the slug falls back but the title survives', () => {
    const created = json('card', 'create', BOARD, '日本語 — ünïcode') as { id: string };
    assert.strictEqual(created.id, 'n-code');
    assert.ok(readCard('n-code').includes('# 日本語 — ünïcode\n'));
  });

  test('given an empty title, when created, then a card is still written with the fallback slug', () => {
    const created = json('card', 'create', BOARD, '') as { id: string };
    assert.strictEqual(created.id, 'card');
    assert.deepStrictEqual(cardFiles(), ['01-card.md']);
  });

  test('given an unknown board or column, when creating, then it exits 1 and writes no file', () => {
    const unknownBoard = run('card', 'create', 'nope', 'X');
    assert.strictEqual(unknownBoard.code, 1);
    assert.match(unknownBoard.err, /unknown board nope/);
    const unknownColumn = run('card', 'create', BOARD, 'X', '--column', 'nope');
    assert.strictEqual(unknownColumn.code, 1);
    assert.match(unknownColumn.err, /unknown column nope/);
    assert.deepStrictEqual(cardFiles(), []);
  });

  test('given no flags at all, when updating, then it is a usage error', () => {
    run('card', 'create', BOARD, 'Target');
    const r = run('card', 'update', BOARD, 'target');
    assert.strictEqual(r.code, 2);
    assert.match(r.err, /nothing to change/);
  });

  test('given bad values, when updating, then each flag is rejected with exit 2 and nothing is written', () => {
    run('card', 'create', BOARD, 'Target');
    const before = readCard('target');
    for (const argv of [
      ['--title', ''],
      ['--priority', 'urgent'],
      ['--progress', '101'],
      ['--progress', '-1'],
      ['--progress', '1.5'],
      ['--live', 'perhaps'],
    ]) {
      const r = run('card', 'update', BOARD, 'target', ...argv);
      assert.strictEqual(r.code, 2, `${argv.join(' ')} should be a usage error: ${r.out}${r.err}`);
    }
    assert.strictEqual(readCard('target'), before, 'a rejected update must not touch the file');
  });

  test('given empty values, when updating, then the matching keys are removed', () => {
    run('card', 'create', BOARD, 'Target', '--labels', 'a,b', '--agent', 'dana');
    run('card', 'update', BOARD, 'target', '--status', 'busy', '--progress', '10');
    run(
      'card',
      'update',
      BOARD,
      'target',
      '--agent',
      '',
      '--status',
      '',
      '--progress',
      '',
      '--labels',
      ' , , ',
    );
    const content = readCard('target');
    for (const key of ['agent:', 'status:', 'progress:', 'labels:']) {
      assert.ok(!content.includes(key), `${key} should be gone, file is:\n${content}`);
    }
  });

  test('given an unknown card, when updating, then it exits 1 naming the card', () => {
    const r = run('card', 'update', BOARD, 'nope', '--priority', 'high');
    assert.strictEqual(r.code, 1);
    assert.match(r.err, /unknown card nope/);
  });
});

describe('repodoc card set — adversarial', () => {
  beforeEach(() => {
    run('card', 'create', BOARD, 'Target');
  });

  const set = (...rest: string[]): Result => run('card', 'set', BOARD, 'target', ...rest);

  test('given a non-numeric number, when set, then it is a usage error and no key is written', () => {
    const r = set('count', 'abc');
    assert.strictEqual(r.code, 2);
    assert.match(r.err, /field expects a number/);
    assert.ok(!readCard('target').includes('count:'));
  });

  test('given a non-boolean boolean, when set, then it is a usage error', () => {
    const r = set('approved', 'maybe');
    assert.strictEqual(r.code, 2);
    assert.match(r.err, /field expects true or false/);
  });

  test('given yes/no/1/0, when a boolean is set, then they are accepted', () => {
    set('approved', 'yes');
    assert.match(readCard('target'), /approved:\s*true/);
    set('approved', '0');
    assert.match(readCard('target'), /approved:\s*false/);
  });

  test('given a value outside a select’s options, when set, then it is written anyway (the UI warns, data is kept)', () => {
    const r = set('size', 'XXL');
    assert.strictEqual(r.code, 0);
    assert.match(readCard('target'), /size:\s*XXL/);
  });

  test('given nonsense in a date field, when set, then it is written verbatim (no date validation)', () => {
    assert.strictEqual(set('due', 'not-a-date').code, 0);
    assert.match(readCard('target'), /due:\s*not-a-date/);
  });

  test('given an empty multiselect, when set, then the key is removed and JSON reports null', () => {
    set('tags', 'a,b');
    assert.match(readCard('target'), /tags:\s*\[a, b\]/);
    const emitted = json('card', 'set', BOARD, 'target', 'tags', '') as { value: unknown };
    assert.strictEqual(emitted.value, null);
    assert.ok(!readCard('target').includes('tags:'));
  });

  test('given blank items in a multiselect, when set, then they are dropped', () => {
    set('tags', ' a , , b ');
    assert.match(readCard('target'), /tags:\s*\[a, b\]/);
  });

  test('given an empty text value, when set, then an empty string is stored (use --clear to remove)', () => {
    assert.strictEqual(set('note', '').code, 0);
    assert.match(readCard('target'), /note:\s*""/);
    assert.strictEqual(set('note', '--clear').code, 0);
    assert.ok(!readCard('target').includes('note:'));
  });

  test('given an undeclared field, when set, then it exits 1 pointing at the config', () => {
    const r = set('nope', 'x');
    assert.strictEqual(r.code, 1);
    assert.match(r.err, /unknown field nope/);
    assert.match(r.err, /boards\/project-backlog\/\.config\.json/);
  });

  test('given no value and no --clear, when set, then it is a usage error', () => {
    const r = set('note');
    assert.strictEqual(r.code, 2);
    assert.match(r.err, /missing <value>/);
  });

  test('given a value with a newline, when set, then it cannot forge another frontmatter key', () => {
    assert.strictEqual(set('note', 'ok\ncolumn: done').code, 0);
    const content = readCard('target');
    assert.strictEqual(
      content.split('\n').filter((l) => l.startsWith('column:')).length,
      1,
      `only the real column key may exist, file is:\n${content}`,
    );
    assert.match(content, /column:\s*backlog/);
  });
});

describe('repodoc card check / check-add — adversarial', () => {
  test('given a card with Gates and Comments but no Checklist, when an item is added, then it lands before Gates', () => {
    fs.writeFileSync(
      path.join(boardDir(), '01-gated.md'),
      '---\ncolumn: backlog\n---\n# Gated\n\nDesc.\n\n## Gates\n\n- [x] tests — ok\n\n## Comments\n\n- **x** (t): hi\n',
    );
    const emitted = json('card', 'check-add', BOARD, 'gated', 'first item') as {
      index: number;
      item: { text: string; done: boolean };
    };
    assert.deepStrictEqual(emitted.index, 0);
    assert.deepStrictEqual(emitted.item, { text: 'first item', done: false });
    const body = readCard('gated');
    assert.ok(
      body.indexOf('## Checklist') < body.indexOf('## Gates'),
      `Checklist must precede Gates, file is:\n${body}`,
    );
    assert.ok(body.includes('## Checklist\n\n- [ ] first item\n\n## Gates\n'));
  });

  test('given an out-of-range index, when checking, then it exits 1 and the file is untouched', () => {
    run('card', 'create', BOARD, 'Target');
    run('card', 'check-add', BOARD, 'target', 'only one');
    const before = readCard('target');
    for (const index of ['1', '-1', '9', 'abc', '1.5']) {
      const r = run('card', 'check', BOARD, 'target', index);
      assert.strictEqual(r.code, 1, `index ${index} should be refused`);
      assert.match(r.err, /out of range/);
    }
    assert.strictEqual(readCard('target'), before);
  });

  test('given a valid index, when checking, then the box flips and JSON reports the item', () => {
    run('card', 'create', BOARD, 'Target');
    run('card', 'check-add', BOARD, 'target', 'do it');
    const emitted = json('card', 'check', BOARD, 'target', '0') as {
      index: number;
      item: { done: boolean };
    };
    assert.strictEqual(emitted.item.done, true);
    assert.match(readCard('target'), /- \[x\] do it/);
  });

  test('given an unknown card, when adding a checklist item, then it exits 1', () => {
    const r = run('card', 'check-add', BOARD, 'nope', 'x');
    assert.strictEqual(r.code, 1);
    assert.match(r.err, /unknown card nope/);
  });
});

describe('repodoc card describe — adversarial', () => {
  test('given an empty text, when describing, then the description is cleared and sections survive', () => {
    fs.writeFileSync(
      path.join(boardDir(), '01-target.md'),
      '---\ncolumn: backlog\n---\n# Target\n\nold description\n\n## Checklist\n\n- [ ] keep\n',
    );
    const emitted = json('card', 'describe', BOARD, 'target', '') as { desc: unknown };
    assert.strictEqual(emitted.desc, null);
    const content = readCard('target');
    assert.ok(!content.includes('old description'));
    assert.ok(content.includes('## Checklist\n\n- [ ] keep\n'));
  });

  test('given multi-paragraph text, when describing, then the paragraphs land verbatim', () => {
    run('card', 'create', BOARD, 'Target');
    run('card', 'describe', BOARD, 'target', 'one\n\ntwo');
    assert.ok(readCard('target').includes('# Target\n\none\n\ntwo\n'));
  });

  test('given a missing text argument, when describing, then it is a usage error', () => {
    run('card', 'create', BOARD, 'Target');
    const r = run('card', 'describe', BOARD, 'target');
    assert.strictEqual(r.code, 2);
    assert.match(r.err, /missing argument: <text>/);
  });
});

describe('repodoc card move — adversarial', () => {
  beforeEach(() => {
    run('card', 'create', BOARD, 'One');
    run('card', 'create', BOARD, 'Two');
    run('card', 'create', BOARD, 'Three');
  });

  test('given a negative index, when moving, then the card lands at the top of the column', () => {
    assert.strictEqual(run('card', 'move', BOARD, 'three', 'backlog', '--index', '-1').code, 0);
    assert.deepStrictEqual(cardFiles(), ['01-three.md', '02-one.md', '03-two.md']);
  });

  test('given a huge index, when moving, then the card lands at the bottom', () => {
    assert.strictEqual(
      run('card', 'move', BOARD, 'one', 'backlog', '--index', '999999999').code,
      0,
    );
    assert.deepStrictEqual(cardFiles(), ['01-two.md', '02-three.md', '03-one.md']);
  });

  test('given a non-integer index, when moving, then it is a usage error and nothing moves', () => {
    const r = run('card', 'move', BOARD, 'one', 'todo', '--index', '1.5');
    assert.strictEqual(r.code, 2);
    assert.match(r.err, /--index expects an integer/);
    assert.deepStrictEqual(cardFiles(), ['01-one.md', '02-two.md', '03-three.md']);
  });

  test('given a failing gate, when moving, then it refuses with the gate prompt and writes nothing', () => {
    const before = readCard('one');
    const r = run('card', 'move', BOARD, 'one', 'done');
    assert.strictEqual(r.code, 1);
    assert.match(r.err, /refusing to move one → done/);
    assert.match(r.err, /Ask a human to approve\./);
    assert.match(r.err, /Only a human may authorise/);
    assert.strictEqual(readCard('one'), before, 'a refused move must not touch the card');
  });

  test('given --override with no reason or a blank one, when moving, then it is refused and no override is recorded', () => {
    for (const argv of [['--override'], ['--override', '--reason', '   ']]) {
      const r = run('card', 'move', BOARD, 'one', 'done', ...argv);
      assert.strictEqual(r.code, 2, `${argv.join(' ')} should be a usage error`);
      assert.match(r.err, /--override requires --reason/);
    }
    assert.ok(!readCard('one').includes('OVERRIDDEN'), 'no override line may be written');
  });

  test('given --override --reason, when moving, then the override is journalled and the prompt is printed', () => {
    const r = run('card', 'move', BOARD, 'one', 'done', '--override', '--reason', 'hotfix now');
    assert.strictEqual(r.code, 0, r.err);
    assert.match(r.out, /Moved one → done \(overrode signoff\)/);
    assert.match(r.out, /Now that one is in Done:/);
    assert.match(r.out, /Tell the reporter\./);
    const content = readCard('one');
    assert.match(content, /column:\s*done/);
    assert.match(content, /- \[x\] signoff — OVERRIDDEN \(tester, .+\): hotfix now/);
  });

  test('given the gate field is satisfied, when moving, then no override is recorded', () => {
    run('card', 'set', BOARD, 'one', 'approved', 'true');
    const emitted = json('card', 'move', BOARD, 'one', 'done') as { overridden: string[] };
    assert.deepStrictEqual(emitted.overridden, []);
    assert.ok(!readCard('one').includes('OVERRIDDEN'));
  });

  test('given an unknown card or column, when moving, then it exits 1 and nothing is renumbered', () => {
    const before = cardFiles();
    const unknownCard = run('card', 'move', BOARD, 'nope', 'todo');
    assert.strictEqual(unknownCard.code, 1);
    assert.match(unknownCard.err, /unknown card nope/);
    const unknownColumn = run('card', 'move', BOARD, 'one', 'nope');
    assert.strictEqual(unknownColumn.code, 1);
    assert.match(unknownColumn.err, /unknown column nope; columns: backlog, todo, done/);
    assert.deepStrictEqual(cardFiles(), before);
  });

  test('given two files sharing a slug, when moving, then it refuses and asks for a rename', () => {
    fs.copyFileSync(path.join(boardDir(), '01-one.md'), path.join(boardDir(), '09-one.md'));
    const r = run('card', 'move', BOARD, 'one', 'todo');
    assert.strictEqual(r.code, 1);
    assert.match(r.err, /two card files share the slug "one"/);
    assert.ok(fs.existsSync(path.join(boardDir(), '09-one.md')), 'neither file is renamed');
  });

  test('given a move that will be refused, when it is overridden, then no override is recorded', () => {
    // The store validates the move before it records anything, so a card can
    // never claim a bypassed gate for a move that never happened.
    fs.copyFileSync(path.join(boardDir(), '01-one.md'), path.join(boardDir(), '09-one.md'));
    const r = run('card', 'move', BOARD, 'one', 'done', '--override', '--reason', 'hotfix');
    assert.strictEqual(r.code, 1);
    assert.match(r.err, /two card files share the slug "one"/);
    for (const name of cardFiles()) {
      const content = fs.readFileSync(path.join(boardDir(), name), 'utf8');
      assert.ok(
        !content.includes('OVERRIDDEN'),
        `a refused move must not journal an override, but ${name} says:\n${content}`,
      );
    }
  });
});

describe('repodoc board show — malformed config', () => {
  test('given a board whose config is malformed, when shown, then the default columns print and stderr warns', () => {
    // Decision 4: the cards are the data — they must stay visible — but the
    // substitution is reported, and only on stderr so --json stays parseable.
    fs.writeFileSync(path.join(boardDir(), '.config.json'), '{ not json at all');
    fs.writeFileSync(path.join(boardDir(), '01-card.md'), '---\ncolumn: doing\n---\n# A card\n');
    const shown = run('board', 'show', BOARD);
    assert.strictEqual(shown.code, 0, shown.err);
    assert.match(shown.out, /## In Progress \(doing\)/);
    assert.match(shown.out, /card {2}A card/);
    assert.match(shown.err, /\.config\.json is missing or declares no usable columns/);

    const asJson = run('board', 'show', BOARD, '--json');
    assert.strictEqual(asJson.code, 0);
    const board = JSON.parse(asJson.out) as { columns: Array<{ id: string }> };
    assert.deepStrictEqual(
      board.columns.map((c) => c.id),
      ['backlog', 'todo', 'doing', 'review', 'done'],
      'stdout is still clean JSON',
    );
    assert.match(asJson.err, /declares no usable columns/);
  });

  test('given a sound config, when shown, then stderr stays empty', () => {
    run('card', 'create', BOARD, 'One');
    const shown = run('board', 'show', BOARD);
    assert.strictEqual(shown.err, '');
  });
});

describe('repodoc card gate-pass / gates — adversarial', () => {
  beforeEach(() => {
    run('card', 'create', BOARD, 'One');
  });

  test('given recorded evidence, when the gate is a field gate, then it does not satisfy it', () => {
    run('card', 'gate-pass', BOARD, 'one', 'signoff', 'ran it');
    const r = run('card', 'gates', BOARD, 'one', 'done');
    assert.strictEqual(r.code, 1, 'a field gate is evaluated live, not from evidence');
    assert.match(r.out, /FAIL {2}signoff/);
  });

  test('given a satisfied move, when gates are evaluated, then it exits 0 and says PASS', () => {
    run('card', 'set', BOARD, 'one', 'approved', 'true');
    const r = run('card', 'gates', BOARD, 'one', 'done');
    assert.strictEqual(r.code, 0, r.err);
    assert.match(r.out, /PASS {2}signoff/);
  });

  test('given a move with no gates, when evaluated, then it says so and exits 0', () => {
    const r = run('card', 'gates', BOARD, 'one', 'todo');
    assert.strictEqual(r.code, 0);
    assert.match(r.out, /No gates on this move\./);
  });

  test('given a missing result argument, when recording evidence, then it is a usage error', () => {
    const r = run('card', 'gate-pass', BOARD, 'one', 'tests');
    assert.strictEqual(r.code, 2);
    assert.match(r.err, /missing argument: <result>/);
  });

  test('given an empty result, comment or checklist item, then each is a usage error and nothing is written', () => {
    const before = readCard('one');
    const empties: Array<[string[], RegExp]> = [
      [['card', 'gate-pass', BOARD, 'one', 'tests', '  '], /<result> must not be empty/],
      [['card', 'comment', BOARD, 'one', '  '], /<text> must not be empty/],
      [['card', 'check-add', BOARD, 'one', ''], /<text> must not be empty/],
    ];
    for (const [argv, message] of empties) {
      const r = run(...argv);
      assert.strictEqual(r.code, 2, `${argv.join(' ')} should be a usage error: ${r.out}${r.err}`);
      assert.match(r.err, message);
    }
    assert.strictEqual(readCard('one'), before, 'a refused write must not touch the card');
  });

  test('given an unknown card, when recording evidence, then it exits 1 and writes nothing', () => {
    const r = run('card', 'gate-pass', BOARD, 'nope', 'tests', 'green');
    assert.strictEqual(r.code, 1);
    assert.match(r.err, /unknown card nope/);
  });
});

describe('repodoc feature — adversarial', () => {
  beforeEach(() => {
    run('feature', 'set-create', 'Spec Set');
  });

  test('given an unknown set, feature or column, when used, then each command exits 1', () => {
    assert.strictEqual(run('feature', 'list', 'nope').code, 1);
    assert.match(run('feature', 'show', 'nope', 'x').err, /unknown feature set nope/);
    assert.match(run('feature', 'show', 'spec-set', 'nope').err, /unknown feature nope/);
    assert.match(run('feature', 'move', 'spec-set', 'nope', 'proposed').err, /unknown feature/);
    run('feature', 'create', 'spec-set', 'A');
    assert.match(run('feature', 'move', 'spec-set', 'a', 'nope').err, /unknown column nope/);
    assert.match(
      run('feature', 'create', 'spec-set', 'B', '--column', 'nope').err,
      /unknown column/,
    );
  });

  test('given a created feature, when shown as JSON, then the ref, file and status are stable keys', () => {
    run('feature', 'create', 'spec-set', 'Gates block a move');
    const shown = json('feature', 'show', 'spec-set', 'gates-block-a-move') as Record<
      string,
      unknown
    >;
    assert.strictEqual(shown['set'], 'spec-set');
    assert.strictEqual(shown['id'], 'gates-block-a-move');
    assert.strictEqual(shown['file'], 'gates-block-a-move.feature');
    assert.strictEqual(shown['status'], 'proposed');
    assert.strictEqual(
      shown['ref'],
      'spec-set/gates-block-a-move — Gates block a move (features/spec-set/gates-block-a-move.feature)',
    );
  });

  test('given a feature, when moved, then only the status tag changes and the file keeps its name', () => {
    run('feature', 'create', 'spec-set', 'A');
    const file = path.join(root, 'features', 'spec-set', 'a.feature');
    fs.writeFileSync(file, '@status:proposed @ui\nFeature: A\n  Prose.\n\n  Scenario: S\n');
    assert.strictEqual(run('feature', 'move', 'spec-set', 'a', 'verified').code, 0);
    assert.strictEqual(
      fs.readFileSync(file, 'utf8'),
      '@status:verified @ui\nFeature: A\n  Prose.\n\n  Scenario: S\n',
    );
  });
});

describe('repodoc decision / docs — adversarial', () => {
  test('given a status in the wrong case, when set, then it is accepted and normalized', () => {
    run('decision', 'create', 'A Choice');
    const emitted = json('decision', 'status', '01-a-choice', 'accepted') as { status: string };
    assert.strictEqual(emitted.status, 'Accepted');
    assert.match(
      fs.readFileSync(path.join(root, 'decisions/01-a-choice.md'), 'utf8'),
      /status: Accepted/,
    );
  });

  test('given an unsupported status, when set, then it is a usage error and the file is untouched', () => {
    run('decision', 'create', 'A Choice');
    const file = path.join(root, 'decisions/01-a-choice.md');
    const before = fs.readFileSync(file, 'utf8');
    const r = run('decision', 'status', '01-a-choice', 'Rejected');
    assert.strictEqual(r.code, 2);
    assert.match(r.err, /expects Proposed \| Accepted \| Superseded/);
    assert.strictEqual(fs.readFileSync(file, 'utf8'), before);
  });

  test('given an unknown decision or doc, when shown, then each exits 1', () => {
    assert.strictEqual(run('decision', 'show', 'nope').code, 1);
    assert.strictEqual(run('decision', 'status', 'nope', 'Accepted').code, 1);
    assert.strictEqual(run('docs', 'show', 'docs/nope.md').code, 1);
  });

  test('given an empty workspace, when listing, then each command says so and exits 0', () => {
    assert.match(run('decision', 'list').out, /No decisions\./);
    assert.match(run('docs', 'tree').out, /No docs\./);
    assert.match(run('feature', 'sets').out, /No feature sets\./);
  });
});

describe('CLI --json shape stability', () => {
  beforeEach(() => {
    run('card', 'create', BOARD, 'Target', '--priority', 'high', '--labels', 'a,b');
  });

  test('given card show --json, then board, column, ref and the card fields are all present', () => {
    const shown = json('card', 'show', BOARD, 'target') as Record<string, unknown>;
    assert.strictEqual(shown['board'], BOARD);
    assert.strictEqual(shown['column'], 'backlog');
    assert.strictEqual(shown['id'], 'target');
    assert.strictEqual(shown['title'], 'Target');
    assert.strictEqual(shown['priority'], 'high');
    assert.deepStrictEqual(shown['labels'], ['a', 'b']);
    assert.match(String(shown['ref']), /^project-backlog\/target — Target \(boards\//);
  });

  test('given card list --json, then every row carries its column alongside the card', () => {
    const rows = json('card', 'list', BOARD) as Array<Record<string, unknown>>;
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0]?.['column'], 'backlog');
    assert.strictEqual(rows[0]?.['id'], 'target');
  });

  test('given a --column filter naming an unknown column, when listing, then it exits 1', () => {
    const r = run('card', 'list', BOARD, '--column', 'nope');
    assert.strictEqual(r.code, 1);
    assert.match(r.err, /unknown column nope/);
  });

  test('given board show --json, then columns keep their gates, prompt and card ids', () => {
    const board = json('board', 'show', BOARD) as {
      id: string;
      columns: Array<Record<string, unknown>>;
    };
    assert.strictEqual(board.id, BOARD);
    const done = board.columns.find((c) => c['id'] === 'done');
    assert.ok(done, 'the done column is present');
    assert.strictEqual(done['prompt'], '  Tell the reporter.  ');
    assert.deepStrictEqual(
      (done['enter'] as Array<{ id: string }>).map((g) => g.id),
      ['signoff'],
    );
    assert.deepStrictEqual(board.columns[0]?.['cardIds'], ['target']);
  });

  test('given card gates --json on a failing gate, then the results still print before exit 1', () => {
    const r = run('card', 'gates', BOARD, 'target', 'done', '--json');
    assert.strictEqual(r.code, 1);
    const results = JSON.parse(r.out) as Array<{ satisfied: boolean; gate: { id: string } }>;
    assert.deepStrictEqual(
      results.map((x) => [x.gate.id, x.satisfied]),
      [['signoff', false]],
    );
  });
});

describe('CLI global behaviour — adversarial', () => {
  /** Runs the CLI with an explicit root, capturing both streams. */
  function withRoot(rootArg: string, ...argv: string[]): Result {
    let out = '';
    let err = '';
    const code = runCli(['--root', rootArg, ...argv], root, {
      stdout: (s) => {
        out += s;
      },
      stderr: (s) => {
        err += s;
      },
    });
    return { code, out, err };
  }

  test('given --root pointing at a file, when listing, then it is a usage error naming the root', () => {
    // Decision 8: a file-as-root used to report an empty workspace, which reads
    // exactly like a real empty workspace — a mistake worth failing loudly on.
    const file = path.join(root, 'a-file.txt');
    fs.writeFileSync(file, 'contents');
    const r = withRoot(file, 'board', 'list');
    assert.strictEqual(r.code, 2);
    assert.match(r.err, /is not a directory/);
    assert.strictEqual(r.out, '', 'stdout stays empty for a usage error');
    assert.strictEqual(fs.readFileSync(file, 'utf8'), 'contents');
  });

  test('given --root pointing at a missing path, when listing, then it is a usage error pointing at init', () => {
    const missing = path.join(root, 'nope', 'deeper');
    const r = withRoot(missing, 'card', 'list', BOARD);
    assert.strictEqual(r.code, 2);
    assert.match(r.err, /does not exist/);
    assert.match(r.err, /repodoc init --root/);
    assert.ok(!fs.existsSync(missing), 'a refused command creates nothing');
  });

  test('given --root pointing at a missing path, when initializing, then the directory is created', () => {
    const fresh = path.join(root, 'fresh', 'workspace');
    const r = withRoot(fresh, 'init');
    assert.strictEqual(r.code, 0, r.err);
    assert.ok(fs.existsSync(path.join(fresh, 'boards', BOARD, '.config.json')));
  });

  test('given --root pointing at a file, when initializing, then it fails and leaves the file alone', () => {
    const file = path.join(root, 'a-file.txt');
    fs.writeFileSync(file, 'contents');
    const r = withRoot(file, 'init');
    assert.strictEqual(r.code, 2, 'writing into a file-as-root cannot succeed');
    assert.ok(r.err.length > 0, 'the failure is reported on stderr');
    assert.strictEqual(fs.readFileSync(file, 'utf8'), 'contents');
  });

  test('given an unknown command, when run, then it exits 2 with the help text', () => {
    const group = run('nope');
    assert.strictEqual(group.code, 2);
    assert.match(group.err, /unknown command "nope"/);
    const sub = run('card', 'frobnicate');
    assert.strictEqual(sub.code, 2);
    assert.match(sub.err, /unknown command "card frobnicate"/);
  });

  test('given missing positionals, when run, then the usage line and the missing names are printed', () => {
    const r = run('card', 'show', BOARD);
    assert.strictEqual(r.code, 2);
    assert.match(r.err, /repodoc card show <board> <card>/);
    assert.match(r.err, /missing argument: <card>/);
  });

  test('given --version or help, when run, then it exits 0 without touching the workspace', () => {
    assert.strictEqual(run('--version').code, 0);
    assert.match(run('--version').out, /^repodoc \d+\.\d+\.\d+\n$/);
    assert.strictEqual(run('help').code, 0);
    assert.match(run('help').out, /Usage: repodoc <command>/);
  });
});
