import { describe, test } from 'bun:test';
import * as assert from 'node:assert';
import { makeStore, required } from './helpers';

/**
 * Externally-authored files can collide: `01-foo.md` and `02-foo.md` both carry
 * the id `foo`. An id is a card's identity, so the board must list it once —
 * the first file in file-name order wins and the rest are skipped (moving is
 * refused separately with `duplicate-slugs`).
 */
describe('duplicate ids on a board', () => {
  const seed = {
    'boards/b/.config.json': JSON.stringify({
      name: 'B',
      columns: [
        { id: 'todo', name: 'To Do', color: '#fff' },
        { id: 'done', name: 'Done', color: '#fff' },
      ],
    }),
    'boards/b/01-foo.md': '---\ncolumn: todo\n---\n# First foo\n',
    'boards/b/02-foo.md': '---\ncolumn: done\n---\n# Second foo\n',
  };

  test('cardIds carries the id once, from the first file', () => {
    const { store } = makeStore(seed);
    const board = required(store.getBoard('b'), 'board');
    const all = board.columns.flatMap((c) => c.cardIds);
    assert.deepStrictEqual(all, ['foo']);
    assert.strictEqual(required(board.cards['foo'], 'card foo').title, 'First foo');
    assert.strictEqual(required(board.columns[0], 'first column').cardIds.length, 1);
    assert.deepStrictEqual(required(board.columns[1], 'second column').cardIds, []);
  });

  test('moving is still refused until the collision is resolved', () => {
    const { store } = makeStore(seed);
    const moved = store.moveCard('b', 'foo', 'done', 0);
    assert.deepStrictEqual(moved, {
      ok: false,
      error: { code: 'duplicate-slugs', slug: 'foo' },
    });
  });

  test('an edit lands in the file the board shows, whatever order the directory lists', () => {
    // The board reads cards in NUMERIC order, so `01-foo.md` owns the id. A
    // mutation that resolved the id by raw directory order could write to
    // `02-foo.md` instead — an edit that then appeared to do nothing.
    const { fs, store } = makeStore({
      // Seeded (and so listed) with the second file FIRST.
      'boards/b/.config.json': seed['boards/b/.config.json'],
      'boards/b/02-foo.md': seed['boards/b/02-foo.md'] as string,
      'boards/b/01-foo.md': seed['boards/b/01-foo.md'] as string,
    });
    assert.strictEqual(
      fs.listDir('boards/b').find((e) => e.name.endsWith('.md'))?.name,
      '02-foo.md',
      'the directory lists 02 first, so resolving by list order would pick it',
    );
    assert.strictEqual(store.cardFilePath('b', 'foo'), 'boards/b/01-foo.md');

    assert.strictEqual(store.setCardDescription('b', 'foo', 'edited'), true);
    assert.ok(
      required(fs.readFile('boards/b/01-foo.md'), 'the first file').includes('edited'),
      'the edit lands in the file the board shows',
    );
    assert.strictEqual(
      required(fs.readFile('boards/b/02-foo.md'), 'the second file'),
      seed['boards/b/02-foo.md'],
      'the shadowed file is not touched at all',
    );
    assert.strictEqual(required(store.getBoard('b'), 'board').cards['foo']?.desc, 'edited');
  });

  test('a feature set lists a duplicated feature id once', () => {
    const { store } = makeStore({
      'features/s/.config.json': JSON.stringify({
        name: 'S',
        columns: [
          { id: 'proposed', name: 'Proposed', color: '#fff' },
          { id: 'verified', name: 'Verified', color: '#fff' },
        ],
      }),
      // Both file names yield the id `login` (the extension match is case-insensitive).
      'features/s/login.feature': '@status:proposed\nFeature: First\n',
      'features/s/login.FEATURE': '@status:verified\nFeature: Second\n',
    });
    const board = required(store.getFeatureSet('s'), 'feature set');
    const ids = board.columns.flatMap((c) => c.cardIds);
    assert.deepStrictEqual(ids, ['login']);
    assert.strictEqual(required(board.cards['login'], 'feature login').title, 'First');
  });
});
