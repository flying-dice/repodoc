import * as assert from 'assert';
import { makeStore } from './helpers';

/** Minimal valid board config JSON with the given columns. */
function configJson(name: string, columnIds: string[]): string {
  return JSON.stringify({
    name,
    columns: columnIds.map((id) => ({ id, name: id, color: '#000000' })),
    labels: {},
    agents: {},
  });
}

/** A card file body with a `column` in frontmatter and a title heading. */
function cardMd(column: string, title: string): string {
  return `---\ncolumn: ${column}\n---\n# ${title}\n`;
}

suite('store.init', () => {
  test('creates ONLY the starter board config — never content', () => {
    const { fs, store } = makeStore();
    store.init();
    const keys = Object.keys(fs.snapshot()).sort();
    assert.deepStrictEqual(keys, ['boards/project-backlog/.config.json']);
    const config = JSON.parse(fs.readFile('boards/project-backlog/.config.json')!);
    assert.strictEqual(config.name, 'Project Backlog');
    assert.strictEqual(config.columns.length, 5);
  });

  test('is idempotent — a second init does not overwrite existing files', () => {
    const { fs, store } = makeStore();
    store.init();
    // Tamper with the seeded config; a re-init must leave it untouched because
    // the board config already exists.
    fs.writeFile('boards/project-backlog/.config.json', '{"name":"Tampered"}');
    const before = fs.snapshot();
    store.init();
    assert.deepStrictEqual(fs.snapshot(), before);
    assert.strictEqual(fs.readFile('boards/project-backlog/.config.json'), '{"name":"Tampered"}');
  });

  test('isInitialized reflects presence of boards/ or decisions/', () => {
    const { store } = makeStore();
    assert.strictEqual(store.isInitialized(), false);
    store.init();
    assert.strictEqual(store.isInitialized(), true);
  });
});

suite('store.listBoards', () => {
  test('lists non-dot board dirs sorted by display name', () => {
    const { store } = makeStore({
      'boards/zeta/.config.json': configJson('Zeta Board', ['todo']),
      'boards/alpha/.config.json': configJson('Alpha Board', ['todo']),
      'boards/alpha/01-a.md': cardMd('todo', 'A'),
    });
    const boards = store.listBoards();
    assert.deepStrictEqual(
      boards.map((b) => b.name),
      ['Alpha Board', 'Zeta Board'],
    );
    const alpha = boards.find((b) => b.id === 'alpha');
    assert.strictEqual(alpha?.cardCount, 1);
  });

  test('malformed .config.json degrades — board still listed, name from id', () => {
    const { store } = makeStore({
      'boards/my-board/.config.json': 'not: valid json {{{',
      'boards/my-board/01-a.md': cardMd('todo', 'A'),
    });
    const boards = store.listBoards();
    assert.strictEqual(boards.length, 1);
    assert.strictEqual(boards[0].id, 'my-board');
    assert.strictEqual(boards[0].name, 'My Board');
    assert.strictEqual(boards[0].cardCount, 1);
  });
});

suite('store.getBoard', () => {
  test('derives columns from config and orders cards by NN prefix', () => {
    const { store } = makeStore({
      'boards/b/.config.json': configJson('B', ['todo', 'done']),
      'boards/b/02-second.md': cardMd('todo', 'Second'),
      'boards/b/01-first.md': cardMd('todo', 'First'),
      'boards/b/03-third.md': cardMd('done', 'Third'),
    });
    const board = store.getBoard('b')!;
    assert.strictEqual(board.name, 'B');
    const todo = board.columns.find((c) => c.id === 'todo')!;
    const done = board.columns.find((c) => c.id === 'done')!;
    // 01 before 02 within the todo column.
    assert.deepStrictEqual(todo.cardIds, ['first', 'second']);
    assert.deepStrictEqual(done.cardIds, ['third']);
    assert.strictEqual(board.cards['first'].title, 'First');
  });

  test('cards with an unknown/blank column land in the FIRST column', () => {
    const { store } = makeStore({
      'boards/b/.config.json': configJson('B', ['todo', 'done']),
      'boards/b/01-known.md': cardMd('done', 'Known'),
      'boards/b/02-unknown.md': cardMd('nonexistent', 'Unknown'),
      'boards/b/03-blank.md': '# No frontmatter card\n',
    });
    const board = store.getBoard('b')!;
    const first = board.columns[0];
    assert.strictEqual(first.id, 'todo');
    assert.ok(first.cardIds.includes('unknown'));
    assert.ok(first.cardIds.includes('blank'));
    // Every card still exists in the map, never dropped.
    assert.deepStrictEqual(Object.keys(board.cards).sort(), ['blank', 'known', 'unknown']);
  });

  test('non-.md and dot files are not treated as cards', () => {
    const { store } = makeStore({
      'boards/b/.config.json': configJson('B', ['todo']),
      'boards/b/01-real.md': cardMd('todo', 'Real'),
      'boards/b/notes.txt': 'not a card',
      'boards/b/.hidden.md': cardMd('todo', 'Hidden'),
    });
    const board = store.getBoard('b')!;
    assert.deepStrictEqual(Object.keys(board.cards), ['real']);
  });

  test('unknown board id returns undefined', () => {
    const { store } = makeStore();
    assert.strictEqual(store.getBoard('nope'), undefined);
  });
});

suite('store.getBoardConfig', () => {
  test('returns labels/agents from config', () => {
    const { store } = makeStore({
      'boards/b/.config.json': JSON.stringify({
        name: 'B',
        columns: [],
        labels: { bug: { name: 'bug', color: '#f00' } },
      }),
    });
    const config = store.getBoardConfig('b');
    assert.deepStrictEqual(Object.keys(config.labels), ['bug']);
  });

  test('falls back to empty labels when absent', () => {
    const { store } = makeStore({
      'boards/b/.config.json': JSON.stringify({ name: 'B', columns: [] }),
    });
    const config = store.getBoardConfig('b');
    assert.deepStrictEqual(config.labels, {});
  });

  test('falls back to empty labels when config file is missing', () => {
    const { store } = makeStore();
    const config = store.getBoardConfig('ghost');
    assert.deepStrictEqual(config.labels, {});
    assert.deepStrictEqual(config.fields, []);
  });
});
