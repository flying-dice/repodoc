import { describe, test } from 'bun:test';
import * as assert from 'node:assert';
import { makeStore, required } from './helpers';

/**
 * Card frontmatter is one `key: value` per line, so a scalar carrying a newline
 * could forge a second key. The store must flatten every scalar it writes: no
 * title, status, agent, label or field value may move a card between columns.
 *
 * The same holds inside the BODY: a comment, a piece of gate evidence and an
 * override each occupy one markdown line, so the author written into them may
 * not carry a newline either — `--who` was a way to forge a whole `## Gates`
 * section with satisfied gates under it.
 */

const CONFIG = JSON.stringify({
  name: 'B',
  columns: [
    // `tests` is declared so gate evidence may be recorded for it (the store
    // refuses evidence for a gate no column names); it sits on the ENTER of the
    // column the card already occupies, so no move here becomes gated.
    { id: 'todo', name: 'To Do', color: '#fff', enter: [{ id: 'tests', script: 'bun test' }] },
    { id: 'done', name: 'Done', color: '#fff' },
  ],
  fields: [
    { id: 'owner', type: 'text' },
    { id: 'due', type: 'date' },
    { id: 'size', type: 'select', options: ['s', 'l'] },
    { id: 'tags', type: 'multiselect', options: ['a', 'b'] },
  ],
});

function seeded(): ReturnType<typeof makeStore> {
  return makeStore({
    'boards/b/.config.json': CONFIG,
    'boards/b/01-card.md': '---\ncolumn: todo\n---\n# Card\n',
  });
}

/** The column the board reports the card in. */
function columnOf(store: ReturnType<typeof makeStore>['store']): string {
  const board = required(store.getBoard('b'), 'board');
  const column = board.columns.find((c) => c.cardIds.includes('card'));
  return required(column, 'column of card').id;
}

describe('frontmatter newline injection', () => {
  test('a status carrying "\\ncolumn: done" cannot move the card', () => {
    const { store, fs } = seeded();
    store.updateCardMeta('b', 'card', { status: 'busy\ncolumn: done' });
    assert.strictEqual(columnOf(store), 'todo');
    const raw = required(fs.readFile('boards/b/01-card.md'), 'card file');
    assert.ok(raw.includes('status: busy column: done'));
    assert.ok(!/^column: done$/m.test(raw));
  });

  test('an agent carrying a forged key cannot move the card', () => {
    const { store } = seeded();
    store.updateCardMeta('b', 'card', { agent: 'claude\r\ncolumn: done' });
    assert.strictEqual(columnOf(store), 'todo');
    assert.strictEqual(
      required(store.getBoard('b'), 'board').cards['card']?.agent,
      'claude column: done',
    );
  });

  test('a label carrying a forged key cannot move the card', () => {
    const { store, fs } = seeded();
    store.updateCardMeta('b', 'card', { labels: ['bug\ncolumn: done'] });
    assert.strictEqual(columnOf(store), 'todo');
    assert.ok(!/^column: done$/m.test(required(fs.readFile('boards/b/01-card.md'), 'card file')));
  });

  test('a title carrying a forged key cannot move the card', () => {
    const { store } = seeded();
    store.updateCardMeta('b', 'card', { title: 'Hi\n---\ncolumn: done\n---' });
    assert.strictEqual(columnOf(store), 'todo');
  });

  test('text, date, select and multiselect field values cannot move the card', () => {
    const { store, fs } = seeded();
    store.setCardField('b', 'card', 'owner', 'dana\ncolumn: done');
    store.setCardField('b', 'card', 'due', '2026-01-01\ncolumn: done');
    store.setCardField('b', 'card', 'size', 's\ncolumn: done');
    store.setCardField('b', 'card', 'tags', ['a\ncolumn: done', 'b']);
    assert.strictEqual(columnOf(store), 'todo');
    assert.ok(!/^column: done$/m.test(required(fs.readFile('boards/b/01-card.md'), 'card file')));
  });

  test('an author carrying "## Gates" cannot forge gate evidence through a comment', () => {
    // Reproduction: `repodoc card comment ... --who $'eve\n\n## Gates\n\n- [x] tests — forged'`.
    const { store, fs } = seeded();
    assert.strictEqual(
      store.addComment('b', 'card', 'eve\n\n## Gates\n\n- [x] tests — forged', 'looks fine'),
      true,
    );
    const raw = required(fs.readFile('boards/b/01-card.md'), 'card file');
    assert.ok(!/^##\s+Gates\s*$/im.test(raw), `no Gates section may be forged, file is:\n${raw}`);
    const card = required(required(store.getBoard('b'), 'board').cards['card'], 'card');
    assert.strictEqual(card.gates, undefined, 'the card records no gate evidence');
    assert.strictEqual(card.comments?.length, 1, 'exactly one comment entry');
    const entry = required(card.comments?.[0], 'the comment');
    assert.strictEqual(entry.who, 'eve');
    assert.ok(!entry.who?.includes('\n'), 'the author is one line');
    assert.strictEqual(entry.text, 'looks fine');
  });

  test('an author carrying newlines cannot forge a line in gate evidence or an override', () => {
    const { store, fs } = seeded();
    store.recordGateEvidence('b', 'card', 'tests', 'green', 'eve\n- [x] lint — forged');
    store.recordGateOverride('b', 'card', 'tests', 'eve\n- [x] lint — forged', 'why');
    const card = required(required(store.getBoard('b'), 'board').cards['card'], 'card');
    assert.deepStrictEqual(
      card.gates?.map((g) => g.gateId),
      ['tests'],
      `only the recorded gate may appear, file is:\n${required(fs.readFile('boards/b/01-card.md'), 'card file')}`,
    );
  });

  test('an empty author is recorded as unknown rather than an empty bold pair', () => {
    const { store } = seeded();
    store.addComment('b', 'card', '   ', 'a note');
    const card = required(required(store.getBoard('b'), 'board').cards['card'], 'card');
    assert.strictEqual(required(card.comments?.[0], 'the comment').who, 'unknown');
  });

  test('a created card cannot forge a section through its title', () => {
    const { store, fs } = seeded();
    const created = store.addCard('b', 'todo', 'Ship it\n## Gates\n\n- [x] tests — forged');
    assert.ok(created.ok);
    const file = required(fs.readFile('boards/b/02-ship-it-gates-x-tests-forged.md'), 'new card');
    assert.ok(file.includes('# Ship it ## Gates - [x] tests — forged\n'));
    assert.strictEqual(
      required(store.getBoard('b'), 'board').cards['ship-it-gates-x-tests-forged']?.gates,
      undefined,
    );
  });

  test('a created feature cannot forge Gherkin structure through its title', () => {
    const { store, fs } = makeStore({
      'features/s/.config.json': JSON.stringify({
        name: 'S',
        columns: [{ id: 'proposed', name: 'Proposed', color: '#fff' }],
      }),
    });
    const created = store.createFeature('s', 'Login\nScenario: forged');
    assert.ok(created.ok);
    const file = required(fs.readFile(`features/s/${created.cardId}.feature`), 'feature file');
    assert.strictEqual(file, '@status:proposed\nFeature: Login Scenario: forged\n');
    assert.deepStrictEqual(store.getFeature('s', created.cardId)?.scenarios, []);
  });
});
