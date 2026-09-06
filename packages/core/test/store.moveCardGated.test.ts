/**
 * `RepoDocStore.moveCardGated` — the one gate policy both hosts call.
 *
 * The ordering is the contract: a move that cannot succeed must be refused
 * BEFORE an override is journalled, or a card ends up claiming a bypassed gate
 * for a move that never happened.
 */

import { describe, test } from 'bun:test';
import * as assert from 'node:assert';
import { makeStore, required } from './helpers';

const STAMP = '2026-01-01T00:00:00.000Z';

const CONFIG = JSON.stringify({
  name: 'Board',
  columns: [
    { id: 'todo', name: 'To Do', color: '#000' },
    {
      id: 'done',
      name: 'Done',
      color: '#000',
      enter: [{ id: 'signoff', field: 'approved', check: '= true' }],
    },
  ],
  labels: {},
  fields: [{ id: 'approved', type: 'boolean' }],
});

function seed(extra: Record<string, string> = {}): ReturnType<typeof makeStore> {
  return makeStore({
    'boards/b/.config.json': CONFIG,
    'boards/b/01-one.md': '---\ncolumn: todo\n---\n# One\n',
    'boards/b/02-two.md': '---\ncolumn: todo\n---\n# Two\n',
    ...extra,
  });
}

/** The card file behind `slug`, whatever number prefix a move left it with. */
function readCard(fs: ReturnType<typeof makeStore>['fs'], slug: string): string {
  const name = fs
    .listDir('boards/b')
    .map((e) => e.name)
    .find((n) => n.replace(/^\d+-/, '').replace(/\.md$/, '') === slug);
  return required(name === undefined ? undefined : fs.readFile(`boards/b/${name}`), `card ${slug}`);
}

describe('store.moveCardGated', () => {
  test('given no gates on the move, when moved, then it succeeds with nothing overridden', () => {
    const { store } = seed();
    assert.deepStrictEqual(store.moveCardGated('b', 'one', 'todo', 0), {
      ok: true,
      overridden: [],
    });
  });

  test('given a failing gate and no override, when moved, then it is refused and not one byte changes', () => {
    const { fs, store } = seed();
    const before = fs.snapshot();
    const result = store.moveCardGated('b', 'one', 'done', 0);
    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual('blocked' in result ? result.blocked.map((r) => r.gate.id) : undefined, [
      'signoff',
    ]);
    assert.deepStrictEqual(fs.snapshot(), before);
  });

  test('given an override with no reason, when moved, then it is refused exactly as an un-overridden move is', () => {
    const { fs, store } = seed();
    const before = fs.snapshot();
    const result = store.moveCardGated('b', 'one', 'done', 0, {
      override: { who: 'tester', reason: '   ' },
    });
    assert.ok(!result.ok && 'blocked' in result, 'a reasonless override is not an override');
    assert.deepStrictEqual(fs.snapshot(), before);
  });

  test('given an override with a reason, when moved, then the gate is journalled and the card moves', () => {
    const { fs, store } = seed();
    assert.deepStrictEqual(
      store.moveCardGated('b', 'one', 'done', 0, {
        override: { who: 'tester', reason: 'hotfix now' },
      }),
      { ok: true, overridden: ['signoff'] },
    );
    const content = readCard(fs, 'one');
    assert.match(content, /column: done/);
    assert.ok(content.includes(`- [x] signoff — OVERRIDDEN (tester, ${STAMP}): hotfix now`));
  });

  test('given a satisfied gate, when moved with an override, then nothing is journalled', () => {
    const { fs, store } = seed();
    store.setCardField('b', 'one', 'approved', true);
    assert.deepStrictEqual(
      store.moveCardGated('b', 'one', 'done', 0, {
        override: { who: 'tester', reason: 'belt and braces' },
      }),
      { ok: true, overridden: [] },
    );
    assert.ok(!readCard(fs, 'one').includes('OVERRIDDEN'));
  });

  test('given duplicate slugs, when an overridden move is asked for, then no override is recorded', () => {
    // The defect this method exists for: the override used to be written before
    // the store got a chance to refuse the move.
    const { fs, store } = seed({ 'boards/b/09-one.md': '---\ncolumn: todo\n---\n# One again\n' });
    const before = fs.snapshot();
    assert.deepStrictEqual(
      store.moveCardGated('b', 'one', 'done', 0, {
        override: { who: 'tester', reason: 'hotfix' },
      }),
      { ok: false, error: { code: 'duplicate-slugs', slug: 'one' } },
    );
    assert.deepStrictEqual(fs.snapshot(), before, 'a refused move writes nothing at all');
  });

  test('given an unknown board, card or column, when moved, then the error names it and nothing is written', () => {
    const { fs, store } = seed();
    const before = fs.snapshot();
    assert.deepStrictEqual(store.moveCardGated('nope', 'one', 'todo', 0), {
      ok: false,
      error: { code: 'unknown-board', boardId: 'nope' },
    });
    assert.deepStrictEqual(store.moveCardGated('b', 'nope', 'todo', 0), {
      ok: false,
      error: { code: 'unknown-card', cardId: 'nope' },
    });
    assert.deepStrictEqual(
      store.moveCardGated('b', 'one', 'nope', 0, {
        override: { who: 'tester', reason: 'why not' },
      }),
      { ok: false, error: { code: 'unknown-column', columnId: 'nope' } },
    );
    assert.deepStrictEqual(fs.snapshot(), before);
  });

  test('given a move, when it succeeds, then listeners fire', () => {
    const { store } = seed();
    let fired = 0;
    store.onDidChange(() => fired++);
    store.moveCardGated('b', 'one', 'todo', 0);
    assert.ok(fired > 0);
  });
});

/**
 * The gates guarding a move are the SOURCE column's exit gates plus the
 * target's enter gates — and the source column is the one the board shows the
 * card in. A card whose `column:` names nothing the config declares is shown in
 * the first column, so that column's exit gates guard it; reading the raw
 * frontmatter value instead let such a card leave the column ungated.
 */
describe('store.moveCardGated — an undeclared source column', () => {
  const EXIT_CONFIG = JSON.stringify({
    name: 'Board',
    columns: [
      {
        id: 'todo',
        name: 'To Do',
        color: '#000',
        exit: [{ id: 'signoff', field: 'approved', check: '= true' }],
      },
      { id: 'done', name: 'Done', color: '#000' },
    ],
    labels: {},
    fields: [{ id: 'approved', type: 'boolean' }],
  });

  /** A board whose only card declares `column: <column>` (or no column at all). */
  function strayCard(column: string | undefined): ReturnType<typeof makeStore> {
    const frontmatter = column === undefined ? '' : `column: ${column}\n`;
    return makeStore({
      'boards/b/.config.json': EXIT_CONFIG,
      'boards/b/01-one.md': `---\n${frontmatter}---\n# One\n`,
    });
  }

  for (const [name, column] of [
    ['an unknown column id', 'mystery'],
    ['no column key at all', undefined],
  ] as Array<[string, string | undefined]>) {
    test(`given a card with ${name}, when moved, then the first column's exit gate blocks it`, () => {
      const { fs, store } = strayCard(column);
      const board = required(store.getBoard('b'), 'board');
      assert.deepStrictEqual(
        required(board.columns[0], 'first column').cardIds,
        ['one'],
        'the board shows the card in the first column',
      );

      assert.deepStrictEqual(
        store.evaluateMove('b', 'one', 'done').map((r) => [r.gate.id, r.satisfied]),
        [['signoff', false]],
        "the first column's exit gates are evaluated",
      );

      const before = fs.snapshot();
      const result = store.moveCardGated('b', 'one', 'done', 0);
      assert.strictEqual(result.ok, false);
      assert.deepStrictEqual(
        'blocked' in result ? result.blocked.map((r) => r.gate.id) : undefined,
        ['signoff'],
      );
      assert.deepStrictEqual(fs.snapshot(), before, 'a blocked move writes nothing');
    });
  }

  test('given the exit gate is satisfied, when the stray card is moved, then it goes through', () => {
    const { store } = strayCard('mystery');
    store.setCardField('b', 'one', 'approved', true);
    assert.deepStrictEqual(store.moveCardGated('b', 'one', 'done', 0), {
      ok: true,
      overridden: [],
    });
  });

  test('given a move into the column the board already shows it in, then there are no gates', () => {
    // `todo` is where the board puts it, so this is a no-op move, not an exit.
    const { store } = strayCard('mystery');
    assert.deepStrictEqual(store.evaluateMove('b', 'one', 'todo'), []);
  });
});
