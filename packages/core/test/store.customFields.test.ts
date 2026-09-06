import { describe, test } from 'bun:test';
import * as assert from 'assert';
import { makeStore } from './helpers';
import { CustomFieldDef } from '../src/types';

function configJson(fields: CustomFieldDef[]): string {
  return JSON.stringify({
    name: 'B',
    columns: [{ id: 'todo', name: 'To Do', color: '#000000' }],
    labels: {},
    agents: {},
    fields,
  });
}

const FIELDS: CustomFieldDef[] = [
  { id: 'estimate', type: 'number' },
  { id: 'tags', type: 'multiselect' },
];

function seed(): ReturnType<typeof makeStore> {
  return makeStore({
    'boards/b/.config.json': configJson(FIELDS),
    'boards/b/01-card.md': '---\ncolumn: todo\n---\n# Card\n',
  });
}

describe('store.setCardField', () => {
  test('writes a validated value and stamps updatedAt', () => {
    const { fs, store } = seed();
    store.setCardField('b', 'card', 'estimate', 5);
    assert.strictEqual(
      fs.readFile('boards/b/01-card.md'),
      '---\ncolumn: todo\nestimate: 5\nupdatedAt: 2026-01-01T00:00:00.000Z\n---\n# Card\n',
    );
    assert.strictEqual(store.getBoard('b')!.cards['card'].custom!.estimate, 5);
  });

  test('undefined removes the frontmatter key', () => {
    const { fs, store } = seed();
    store.setCardField('b', 'card', 'estimate', 5);
    store.setCardField('b', 'card', 'estimate', undefined);
    assert.strictEqual(
      fs.readFile('boards/b/01-card.md'),
      '---\ncolumn: todo\nupdatedAt: 2026-01-01T00:00:00.000Z\n---\n# Card\n',
    );
  });

  test('an empty multiselect removes the key', () => {
    const { fs, store } = seed();
    store.setCardField('b', 'card', 'tags', ['a', 'b']);
    assert.ok(fs.readFile('boards/b/01-card.md')!.includes('tags: [a, b]'));
    store.setCardField('b', 'card', 'tags', []);
    assert.ok(!fs.readFile('boards/b/01-card.md')!.includes('tags'));
  });

  test('a wrong-typed value is a silent no-op', () => {
    const { fs, store } = seed();
    const before = fs.snapshot();
    store.setCardField('b', 'card', 'estimate', 'not-a-number');
    assert.deepStrictEqual(fs.snapshot(), before);
  });

  test('an unknown field is a silent no-op', () => {
    const { fs, store } = seed();
    const before = fs.snapshot();
    store.setCardField('b', 'card', 'ghost', 5);
    assert.deepStrictEqual(fs.snapshot(), before);
  });

  test('an unknown card is a silent no-op', () => {
    const { fs, store } = seed();
    const before = fs.snapshot();
    store.setCardField('b', 'missing', 'estimate', 5);
    assert.deepStrictEqual(fs.snapshot(), before);
  });
});
