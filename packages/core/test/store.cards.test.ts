import { describe, test } from 'bun:test';
import * as assert from 'assert';
import { cardFiles, makeStore } from './helpers';

function configJson(columnIds: string[]): string {
  return JSON.stringify({
    name: 'B',
    columns: columnIds.map((id) => ({ id, name: id, color: '#000000' })),
    labels: {},
    agents: {},
  });
}

describe('store.addCard', () => {
  test('derives the slug from the title and writes the expected file shape', () => {
    const { fs, store } = makeStore({ 'boards/b/.config.json': configJson(['todo']) });
    store.addCard('b', 'todo', 'My New Card');
    assert.deepStrictEqual(cardFiles(fs, 'b'), ['01-my-new-card.md']);
    assert.strictEqual(
      fs.readFile('boards/b/01-my-new-card.md'),
      '---\ncolumn: todo\nupdatedAt: 2026-01-01T00:00:00.000Z\n---\n# My New Card\n',
    );
  });

  test('duplicate titles get -2 / -3 slug suffixes', () => {
    const { fs, store } = makeStore({ 'boards/b/.config.json': configJson(['todo']) });
    store.addCard('b', 'todo', 'Same Title');
    store.addCard('b', 'todo', 'Same Title');
    store.addCard('b', 'todo', 'Same Title');
    assert.deepStrictEqual(cardFiles(fs, 'b'), [
      '01-same-title.md',
      '02-same-title-2.md',
      '03-same-title-3.md',
    ]);
  });

  test('empty/emoji-only titles fall back to the "card" slug', () => {
    const { fs, store } = makeStore({ 'boards/b/.config.json': configJson(['todo']) });
    store.addCard('b', 'todo', '🚀');
    assert.deepStrictEqual(cardFiles(fs, 'b'), ['01-card.md']);
  });

  test('new card is appended at the end of its target column', () => {
    const { store } = makeStore({
      'boards/b/.config.json': configJson(['todo', 'done']),
      'boards/b/01-existing.md': '---\ncolumn: todo\n---\n# Existing\n',
    });
    store.addCard('b', 'todo', 'Newer');
    const todo = store.getBoard('b')!.columns.find((c) => c.id === 'todo')!;
    assert.deepStrictEqual(todo.cardIds, ['existing', 'newer']);
  });

  test('unknown column is a silent no-op', () => {
    const { fs, store } = makeStore({ 'boards/b/.config.json': configJson(['todo']) });
    const before = fs.snapshot();
    store.addCard('b', 'nope', 'Ignored');
    assert.deepStrictEqual(fs.snapshot(), before);
  });
});

describe('store.toggleChecklistItem', () => {
  const original =
    '---\n' +
    'column: todo\n' +
    'updatedAt: 2026-01-01T00:00:00.000Z\n' +
    '---\n' +
    '# Card\n' +
    '\n' +
    'Some desc.\n' +
    '\n' +
    '## Checklist\n' +
    '\n' +
    '- [ ] one\n' +
    '- [x] two\n' +
    '- [ ] three\n';

  function seedCard(): ReturnType<typeof makeStore> {
    return makeStore({
      'boards/b/.config.json': configJson(['todo']),
      'boards/b/01-card.md': original,
    });
  }

  test('flips only the addressed item and preserves the rest byte-for-byte', () => {
    const { fs, store } = seedCard();
    store.toggleChecklistItem('b', 'card', 0);
    assert.strictEqual(
      fs.readFile('boards/b/01-card.md'),
      original.replace('- [ ] one', '- [x] one'),
    );
  });

  test('flipping a done item unchecks it', () => {
    const { fs, store } = seedCard();
    store.toggleChecklistItem('b', 'card', 1);
    assert.strictEqual(
      fs.readFile('boards/b/01-card.md'),
      original.replace('- [x] two', '- [ ] two'),
    );
  });

  test('out-of-range index is a no-op (no write at all)', () => {
    const { fs, store } = seedCard();
    const before = fs.snapshot();
    store.toggleChecklistItem('b', 'card', 99);
    assert.deepStrictEqual(fs.snapshot(), before);
    store.toggleChecklistItem('b', 'card', -1);
    assert.deepStrictEqual(fs.snapshot(), before);
  });

  test('derived checklist reflects the toggle', () => {
    const { store } = seedCard();
    store.toggleChecklistItem('b', 'card', 0);
    const checklist = store.getBoard('b')!.cards['card'].checklist!;
    assert.deepStrictEqual(
      checklist.map((c) => c.done),
      [true, true, false],
    );
  });

  test('unknown card is a silent no-op', () => {
    const { fs, store } = seedCard();
    const before = fs.snapshot();
    store.toggleChecklistItem('b', 'ghost', 0);
    assert.deepStrictEqual(fs.snapshot(), before);
  });
});

describe('store.addColumn', () => {
  test('appends a slugified column to the config', () => {
    const { fs, store } = makeStore({ 'boards/b/.config.json': configJson(['todo']) });
    store.addColumn('b', 'In Review');
    const config = JSON.parse(fs.readFile('boards/b/.config.json')!) as {
      columns: Array<{ id: string; name: string; color: string }>;
    };
    assert.deepStrictEqual(config.columns[config.columns.length - 1], {
      id: 'in-review',
      name: 'In Review',
      color: '#7d828b',
    });
    // The new column shows up in the derived board.
    assert.ok(store.getBoard('b')!.columns.some((c) => c.id === 'in-review'));
  });
});
