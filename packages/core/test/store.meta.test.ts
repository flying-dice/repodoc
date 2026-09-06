import { describe, test } from 'bun:test';
import * as assert from 'node:assert';
import { parseFrontmatter } from '../src/frontmatter';
import { formatRef } from '../src/refs';
import { makeStore, required } from './helpers';

const CONFIG = JSON.stringify({
  name: 'B',
  columns: [
    { id: 'todo', name: 'To Do', color: '#000' },
    { id: 'doing', name: 'Doing', color: '#000' },
  ],
  labels: {},
  fields: [],
});

function seed(): ReturnType<typeof makeStore> {
  return makeStore({
    'boards/b/.config.json': CONFIG,
    'boards/b/01-card.md': '---\ncolumn: todo\nagent: old\n---\n# Card\n\nBody text.\n',
  });
}

describe('cardParse — agent', () => {
  test('free-text agent is surfaced on the card', () => {
    const { store } = seed();
    assert.strictEqual(store.getBoard('b')?.cards['card']?.agent, 'old');
  });
});

describe('store.updateCardMeta', () => {
  test('sets, keeps and removes reserved keys; rewrites the title heading', () => {
    const { fs, store } = seed();
    const ok = store.updateCardMeta('b', 'card', {
      title: 'Renamed',
      agent: 'claude',
      live: true,
      status: 'working',
      progress: 40,
      priority: 'high',
      labels: ['a', 'b'],
    });
    assert.strictEqual(ok, true);
    const { data, body } = parseFrontmatter(fs.readFile('boards/b/01-card.md')!);
    assert.deepStrictEqual(
      { ...data, updatedAt: undefined },
      {
        column: 'todo',
        agent: 'claude',
        live: true,
        status: 'working',
        progress: 40,
        priority: 'high',
        labels: ['a', 'b'],
        updatedAt: undefined,
      },
    );
    assert.strictEqual(body, '# Renamed\n\nBody text.\n');

    store.updateCardMeta('b', 'card', { live: null, status: null });
    const after = parseFrontmatter(fs.readFile('boards/b/01-card.md')!).data;
    assert.strictEqual(after['live'], undefined);
    assert.strictEqual(after['status'], undefined);
    assert.strictEqual(after['agent'], 'claude');
    const card = required(store.getBoard('b')?.cards['card'], 'card');
    assert.strictEqual(card.title, 'Renamed');
    assert.strictEqual(card.progress, 40);
  });

  test('inserts a heading when the body has none', () => {
    const { fs, store } = makeStore({
      'boards/b/.config.json': CONFIG,
      'boards/b/01-card.md': '---\ncolumn: todo\n---\njust prose\n',
    });
    store.updateCardMeta('b', 'card', { title: 'New' });
    assert.strictEqual(
      parseFrontmatter(fs.readFile('boards/b/01-card.md')!).body,
      '# New\n\njust prose\n',
    );
    // A newline in a title would split the heading — it is collapsed instead.
    store.updateCardMeta('b', 'card', { title: 'Two\nlines' });
    assert.strictEqual(store.getBoard('b')?.cards['card']?.title, 'Two lines');
  });

  test('unknown card returns false and writes nothing', () => {
    const { fs, store } = seed();
    const before = fs.snapshot();
    assert.strictEqual(store.updateCardMeta('b', 'nope', { agent: 'x' }), false);
    assert.deepStrictEqual(fs.snapshot(), before);
  });

  test('fires listeners once per change', () => {
    const { store } = seed();
    let fired = 0;
    store.onDidChange(() => fired++);
    store.updateCardMeta('b', 'card', { status: 's' });
    store.updateCardMeta('b', 'nope', { status: 's' });
    assert.strictEqual(fired, 1);
  });
});

describe('store mutation results', () => {
  test('addCard reports the created id and refuses unknown boards/columns', () => {
    const { store } = seed();
    assert.deepStrictEqual(store.addCard('b', 'doing', 'Hello World'), {
      ok: true,
      cardId: 'hello-world',
    });
    assert.deepStrictEqual(store.addCard('b', 'nope', 'x'), {
      ok: false,
      error: { code: 'unknown-column', columnId: 'nope' },
    });
    assert.deepStrictEqual(store.addCard('zzz', 'todo', 'x'), {
      ok: false,
      error: { code: 'unknown-board', boardId: 'zzz' },
    });
  });

  test('moveCard reports success and each refusal', () => {
    const { fs, store } = seed();
    assert.deepStrictEqual(store.moveCard('b', 'card', 'doing', 0), { ok: true });
    assert.deepStrictEqual(store.moveCard('b', 'ghost', 'doing', 0), {
      ok: false,
      error: { code: 'unknown-card', cardId: 'ghost' },
    });
    assert.deepStrictEqual(store.moveCard('b', 'card', 'nope', 0), {
      ok: false,
      error: { code: 'unknown-column', columnId: 'nope' },
    });
    assert.deepStrictEqual(store.moveCard('zzz', 'card', 'doing', 0), {
      ok: false,
      error: { code: 'unknown-board', boardId: 'zzz' },
    });
    fs.seed({ 'boards/b/02-card.md': '---\ncolumn: todo\n---\n# Dup\n' });
    assert.deepStrictEqual(store.moveCard('b', 'card', 'doing', 0), {
      ok: false,
      error: { code: 'duplicate-slugs', slug: 'card' },
    });
  });
});

describe('store.recordGateEvidence', () => {
  test('writes a done evidence line with result, author and time', () => {
    const { fs, store } = seed();
    assert.strictEqual(
      store.recordGateEvidence('b', 'card', 'tests', 'bun test green', 'claude'),
      true,
    );
    const body = parseFrontmatter(fs.readFile('boards/b/01-card.md')!).body;
    assert.ok(
      body.includes('## Gates\n\n- [x] tests — bun test green (claude, 2026-01-01T00:00:00.000Z)'),
    );
    assert.deepStrictEqual(store.getBoard('b')?.cards['card']?.gates, [
      { gateId: 'tests', done: true, note: 'bun test green (claude, 2026-01-01T00:00:00.000Z)' },
    ]);
    assert.strictEqual(store.recordGateEvidence('b', 'nope', 'tests', 'x', 'claude'), false);
  });
});

describe('store.cardFilePath', () => {
  test('resolves a card id to its numbered file, undefined when unknown', () => {
    const { store } = seed();
    assert.strictEqual(store.cardFilePath('b', 'card'), 'boards/b/01-card.md');
    assert.strictEqual(store.cardFilePath('b', 'nope'), undefined);
    assert.strictEqual(store.cardFilePath('zzz', 'card'), undefined);
  });
});

describe('store.cardRef / formatRef', () => {
  test('builds `<scope>/<id> — <title> (<path>)`, path optional, unknown card undefined', () => {
    const { store } = seed();
    assert.strictEqual(store.cardRef('b', 'card'), 'b/card — Card (boards/b/01-card.md)');
    assert.strictEqual(store.cardRef('b', 'nope'), undefined);
    assert.strictEqual(formatRef('s', 'x', '  '), 's/x — x');
  });
});
