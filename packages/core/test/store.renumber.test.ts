/**
 * Renumbering card files is all-or-nothing.
 *
 * The bug this covers: the two rename phases had no error path. A throw partway
 * left cards sitting in `.renumber-*.tmp`, where nothing lists them — they were
 * gone from the board, the tree and the CLI with no error — and the next move
 * renamed another card over the top of them.
 */

import { describe, test } from 'bun:test';
import * as assert from 'node:assert';
import { MemFileSystemAdapter } from '../src/adapters/memFileSystem';
import type { DirEntry, FileSystemPort } from '../src/ports';
import { RepoDocStore } from '../src/store';
import { FixedClock } from './helpers';

/** Wraps the in-memory FS and fails the nth rename, as a locked file would. */
class FailingRenameFs implements FileSystemPort {
  private renames = 0;

  constructor(
    private readonly inner: MemFileSystemAdapter,
    /** 1-based index of the rename that throws; 0 never fails. */
    private readonly failAt: number,
  ) {}

  exists(relPath: string): boolean {
    return this.inner.exists(relPath);
  }
  readFile(relPath: string): string | undefined {
    return this.inner.readFile(relPath);
  }
  writeFile(relPath: string, content: string): void {
    this.inner.writeFile(relPath, content);
  }
  listDir(relPath: string): DirEntry[] {
    return this.inner.listDir(relPath);
  }
  rename(fromRel: string, toRel: string): void {
    this.renames++;
    if (this.renames === this.failAt) {
      throw new Error('EPERM: the file is locked by another process');
    }
    this.inner.rename(fromRel, toRel);
  }
}

const CONFIG = JSON.stringify({
  name: 'B',
  columns: [
    { id: 'todo', name: 'Todo', color: '#000000' },
    { id: 'doing', name: 'Doing', color: '#000000' },
  ],
  labels: {},
});

/** A board of three cards, and the store that fails its `failAt`th rename. */
function board(failAt: number): { store: RepoDocStore; fs: MemFileSystemAdapter } {
  const mem = new MemFileSystemAdapter();
  mem.seed({
    'boards/b/.config.json': CONFIG,
    'boards/b/01-alpha.md': '---\ncolumn: todo\n---\n# Alpha\n',
    'boards/b/02-bravo.md': '---\ncolumn: todo\n---\n# Bravo\n',
    'boards/b/03-charlie.md': '---\ncolumn: todo\n---\n# Charlie\n',
  });
  const store = new RepoDocStore(new FailingRenameFs(mem, failAt), new FixedClock(), '/workspace');
  return { store, fs: mem };
}

/** Card files on disk, sorted — `.tmp` leftovers included, deliberately. */
function files(fs: MemFileSystemAdapter): string[] {
  return fs
    .listDir('boards/b')
    .filter((e) => e.kind === 'file' && e.name !== '.config.json')
    .map((e) => e.name)
    .sort();
}

describe('store.renumber — all or nothing', () => {
  test('given no failure, when a card moves, then the files are renumbered', () => {
    const { store, fs } = board(0);
    // Charlie to the head of its own column: every file is renumbered, which
    // is what puts renames on the table at all.
    assert.deepStrictEqual(store.moveCard('b', 'charlie', 'todo', 0), { ok: true });
    assert.deepStrictEqual(files(fs), ['01-charlie.md', '02-alpha.md', '03-bravo.md']);
  });

  for (const failAt of [1, 2, 3, 4, 5, 6]) {
    test(`given rename ${failAt} fails, when a card moves, then every file is put back`, () => {
      const { store, fs } = board(failAt);
      const before = files(fs);

      const result = store.moveCard('b', 'charlie', 'todo', 0);

      assert.deepStrictEqual(
        result,
        { ok: false, error: { code: 'renumber-failed', boardId: 'b' } },
        'the caller is told, rather than left to find out from a half-renamed board',
      );
      assert.deepStrictEqual(files(fs), before, 'the file names are exactly as they were');
      assert.strictEqual(
        files(fs).some((n) => n.includes('renumber')),
        false,
        'no card is left stranded in a temp file',
      );
    });
  }

  test('given a failed renumber, when the board is read, then every card is still there', () => {
    const { store } = board(2);
    store.moveCard('b', 'charlie', 'todo', 0);
    const cards = store.getBoard('b')?.cards ?? {};
    assert.deepStrictEqual(Object.keys(cards).sort(), ['alpha', 'bravo', 'charlie']);
  });

  test('given a failed renumber, when it is retried and succeeds, then it completes', () => {
    const mem = new MemFileSystemAdapter();
    mem.seed({
      'boards/b/.config.json': CONFIG,
      'boards/b/01-alpha.md': '---\ncolumn: todo\n---\n# Alpha\n',
      'boards/b/02-bravo.md': '---\ncolumn: todo\n---\n# Bravo\n',
      'boards/b/03-charlie.md': '---\ncolumn: todo\n---\n# Charlie\n',
    });
    // Fails the first attempt's opening rename, then never again.
    const failing = new FailingRenameFs(mem, 1);
    const store = new RepoDocStore(failing, new FixedClock(), '/workspace');

    assert.strictEqual(store.moveCard('b', 'charlie', 'todo', 0).ok, false);
    assert.deepStrictEqual(store.moveCard('b', 'charlie', 'todo', 0), { ok: true });
    assert.deepStrictEqual(files(mem), ['01-charlie.md', '02-alpha.md', '03-bravo.md']);
  });

  test('given two attempts, when both stage temp files, then the names never collide', () => {
    const { store, fs } = board(3);
    store.moveCard('b', 'charlie', 'todo', 0);
    store.moveCard('b', 'alpha', 'doing', 0);
    assert.strictEqual(
      files(fs).some((n) => n.includes('renumber')),
      false,
      'a reused temp name would let one attempt overwrite another"s stranded card',
    );
  });
});
