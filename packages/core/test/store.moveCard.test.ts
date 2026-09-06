import { describe, test } from 'bun:test';
import * as assert from 'assert';
import { parseFrontmatter } from '../src/frontmatter';
import { MemFileSystemAdapter } from '../src/adapters/memFileSystem';
import { RepoDocStore } from '../src/store';
import { cardFiles, makeStore } from './helpers';

function configJson(columnIds: string[]): string {
  return JSON.stringify({
    name: 'B',
    columns: columnIds.map((id) => ({ id, name: id, color: '#000000' })),
    labels: {},
    agents: {},
  });
}

/** Seeds board `b` with `NN-<slug>.md` files, each in the given column. */
function seedBoard(columnIds: string[], cards: Array<{ slug: string; col: string }>): {
  fs: MemFileSystemAdapter;
  store: RepoDocStore;
  clock: ReturnType<typeof makeStore>['clock'];
} {
  const seed: Record<string, string> = { 'boards/b/.config.json': configJson(columnIds) };
  cards.forEach((c, i) => {
    const nn = String(i + 1).padStart(2, '0');
    seed[`boards/b/${nn}-${c.slug}.md`] = `---\ncolumn: ${c.col}\n---\n# ${c.slug}\n`;
  });
  return makeStore(seed);
}

/** Column of a card as recorded in its own file's frontmatter. */
function columnOnDisk(fs: MemFileSystemAdapter, slug: string): string {
  const file = cardFiles(fs, 'b').find((f) => f.replace(/^\d+-/, '').replace(/\.md$/, '') === slug);
  assert.ok(file, `no file for slug ${slug}`);
  const { data } = parseFrontmatter(fs.readFile(`boards/b/${file}`)!);
  return String(data.column);
}

describe('store.moveCard — within a column', () => {
  test('move to top (index 0)', () => {
    const { fs, store } = seedBoard(['a', 'b'], [
      { slug: 'c1', col: 'a' },
      { slug: 'c2', col: 'a' },
      { slug: 'c3', col: 'a' },
    ]);
    store.moveCard('b', 'c3', 'a', 0);
    assert.deepStrictEqual(store.getBoard('b')!.columns[0].cardIds, ['c3', 'c1', 'c2']);
  });

  test('move to the middle', () => {
    const { store } = seedBoard(['a', 'b'], [
      { slug: 'c1', col: 'a' },
      { slug: 'c2', col: 'a' },
      { slug: 'c3', col: 'a' },
    ]);
    store.moveCard('b', 'c1', 'a', 1);
    assert.deepStrictEqual(store.getBoard('b')!.columns[0].cardIds, ['c2', 'c1', 'c3']);
  });

  test('move past the end appends to the column tail', () => {
    const { store } = seedBoard(['a', 'b'], [
      { slug: 'c1', col: 'a' },
      { slug: 'c2', col: 'a' },
      { slug: 'c3', col: 'a' },
    ]);
    store.moveCard('b', 'c1', 'a', 99);
    assert.deepStrictEqual(store.getBoard('b')!.columns[0].cardIds, ['c2', 'c3', 'c1']);
  });
});

describe('store.moveCard — across columns', () => {
  test('move into another column at index 0', () => {
    const { fs, store } = seedBoard(['a', 'b'], [
      { slug: 'c1', col: 'a' },
      { slug: 'c2', col: 'a' },
      { slug: 'c3', col: 'b' },
    ]);
    store.moveCard('b', 'c1', 'b', 0);
    const board = store.getBoard('b')!;
    assert.deepStrictEqual(board.columns.find((c) => c.id === 'a')!.cardIds, ['c2']);
    assert.deepStrictEqual(board.columns.find((c) => c.id === 'b')!.cardIds, ['c1', 'c3']);
    assert.strictEqual(columnOnDisk(fs, 'c1'), 'b');
  });

  test('move into an empty column', () => {
    const { store } = seedBoard(['a', 'b'], [
      { slug: 'c1', col: 'a' },
      { slug: 'c2', col: 'a' },
    ]);
    store.moveCard('b', 'c1', 'b', 0);
    const board = store.getBoard('b')!;
    assert.deepStrictEqual(board.columns.find((c) => c.id === 'b')!.cardIds, ['c1']);
    assert.deepStrictEqual(board.columns.find((c) => c.id === 'a')!.cardIds, ['c2']);
  });

  test('negative index clamps to the top of the target column', () => {
    const { store } = seedBoard(['a', 'b'], [
      { slug: 'c1', col: 'a' },
      { slug: 'c2', col: 'b' },
      { slug: 'c3', col: 'b' },
    ]);
    store.moveCard('b', 'c1', 'b', -5);
    assert.deepStrictEqual(store.getBoard('b')!.columns.find((c) => c.id === 'b')!.cardIds, [
      'c1',
      'c2',
      'c3',
    ]);
  });

  test('moving the only card keeps it and restamps its column', () => {
    const { fs, store } = seedBoard(['a', 'b'], [{ slug: 'only', col: 'a' }]);
    store.moveCard('b', 'only', 'b', 0);
    assert.strictEqual(columnOnDisk(fs, 'only'), 'b');
    assert.deepStrictEqual(store.getBoard('b')!.columns.find((c) => c.id === 'b')!.cardIds, ['only']);
    assert.deepStrictEqual(cardFiles(fs, 'b'), ['01-only.md']);
  });
});

describe('store.moveCard — no-ops leave files untouched', () => {
  test('unknown board is a silent no-op', () => {
    const { fs, store } = seedBoard(['a'], [{ slug: 'c1', col: 'a' }]);
    const before = fs.snapshot();
    store.moveCard('ghost', 'c1', 'a', 0);
    assert.deepStrictEqual(fs.snapshot(), before);
  });

  test('unknown card is a silent no-op', () => {
    const { fs, store } = seedBoard(['a'], [{ slug: 'c1', col: 'a' }]);
    const before = fs.snapshot();
    store.moveCard('b', 'does-not-exist', 'a', 0);
    assert.deepStrictEqual(fs.snapshot(), before);
  });

  test('unknown target column is a silent no-op', () => {
    const { fs, store } = seedBoard(['a'], [{ slug: 'c1', col: 'a' }]);
    const before = fs.snapshot();
    store.moveCard('b', 'c1', 'nope', 0);
    assert.deepStrictEqual(fs.snapshot(), before);
  });
});

describe('store.moveCard — bookkeeping', () => {
  test('updatedAt is stamped from the injected clock', () => {
    const { fs, store, clock } = seedBoard(['a', 'b'], [{ slug: 'c1', col: 'a' }]);
    clock.set('2030-05-05T12:00:00.000Z');
    store.moveCard('b', 'c1', 'b', 0);
    const { data } = parseFrontmatter(fs.readFile('boards/b/01-c1.md')!);
    assert.strictEqual(data.updatedAt, '2030-05-05T12:00:00.000Z');
  });

  test('files stay contiguously numbered from 01 across an arbitrary move sequence', () => {
    const columns = ['a', 'b', 'c'];
    const slugs = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'];
    const { fs, store } = seedBoard(columns, [
      { slug: 'c1', col: 'a' },
      { slug: 'c2', col: 'a' },
      { slug: 'c3', col: 'b' },
      { slug: 'c4', col: 'b' },
      { slug: 'c5', col: 'c' },
      { slug: 'c6', col: 'c' },
    ]);

    // Deterministic LCG so a failure is reproducible.
    let seed = 0x2545f491;
    const rand = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };

    const checkInvariant = (): void => {
      const files = cardFiles(fs, 'b');
      assert.strictEqual(files.length, slugs.length, 'card count preserved');

      // NN prefixes are exactly 1..N with no gaps or duplicates.
      const nums = files.map((f) => parseInt(f.slice(0, f.indexOf('-')), 10)).sort((x, y) => x - y);
      assert.deepStrictEqual(
        nums,
        Array.from({ length: slugs.length }, (_, i) => i + 1),
      );

      // Each slug appears exactly once.
      const seen = files.map((f) => f.replace(/^\d+-/, '').replace(/\.md$/, ''));
      assert.strictEqual(new Set(seen).size, seen.length, 'no duplicate slugs');

      // Every card's on-disk column matches the column it derives into.
      const board = store.getBoard('b')!;
      const placed = new Map<string, string>();
      for (const col of board.columns) {
        for (const id of col.cardIds) {
          placed.set(id, col.id);
        }
      }
      assert.strictEqual(placed.size, slugs.length, 'every card placed in a column');
      for (const slug of seen) {
        assert.strictEqual(placed.get(slug), columnOnDisk(fs, slug), `placement of ${slug}`);
      }
    };

    checkInvariant();
    for (let i = 0; i < 20; i++) {
      const slug = slugs[Math.floor(rand() * slugs.length)];
      const toCol = columns[Math.floor(rand() * columns.length)];
      const index = Math.floor(rand() * (slugs.length + 2)) - 1; // spans negative..past-end
      store.moveCard('b', slug, toCol, index);
      checkInvariant();
    }
  });
});
