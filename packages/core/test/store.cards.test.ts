import { describe, test } from 'bun:test';
import * as assert from 'node:assert';
import { parseFrontmatter } from '../src/frontmatter';
import { cardFiles, makeStore, required } from './helpers';

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

  test('a slug taken by a file that differs only in case is suffixed', () => {
    // On macOS and Windows `Login.md` and `01-login.md` are different files,
    // but `Login.md` and `login.md` are not — and a hand-named card file can be
    // either. Slugs are compared without case so a new card never claims one.
    const { store } = makeStore({
      'boards/b/.config.json': configJson(['todo']),
      'boards/b/01-Login.md': '---\ncolumn: todo\n---\n# Login\n',
    });
    const created = store.addCard('b', 'todo', 'Login');
    assert.deepStrictEqual(created, { ok: true, cardId: 'login-2' });
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
    const checklist = required(
      required(store.getBoard('b')?.cards['card'], 'card').checklist,
      'checklist',
    );
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

describe('store.addChecklistItem', () => {
  test('appends to an existing ## Checklist section, after the last item', () => {
    const { fs, store } = makeStore({
      'boards/b/.config.json': configJson(['todo']),
      'boards/b/01-card.md': '# Card\n\nDesc.\n\n## Checklist\n\n- [ ] one\n- [x] two\n',
    });
    const ok = store.addChecklistItem('b', 'card', 'three');
    assert.strictEqual(ok, true);
    const { body } = parseFrontmatter(fs.readFile('boards/b/01-card.md')!);
    assert.strictEqual(
      body,
      '# Card\n\nDesc.\n\n## Checklist\n\n- [ ] one\n- [x] two\n- [ ] three\n',
    );
  });

  test('collapses newlines in the text to a single line', () => {
    const { fs, store } = makeStore({
      'boards/b/.config.json': configJson(['todo']),
      'boards/b/01-card.md': '# Card\n\n## Checklist\n\n- [ ] one\n',
    });
    store.addChecklistItem('b', 'card', 'two\nlines here');
    const { body } = parseFrontmatter(fs.readFile('boards/b/01-card.md')!);
    assert.ok(body.includes('- [ ] two lines here'));
    assert.ok(!body.includes('two\nlines'));
  });

  test('creates the section after the description and before Gates/Comments when absent', () => {
    const { fs, store } = makeStore({
      'boards/b/.config.json': configJson(['todo']),
      'boards/b/01-card.md':
        '# Card\n\nSome desc.\n\n## Gates\n\n- [x] tests — ok\n\n## Comments\n\n- **a** (t): hi\n',
    });
    store.addChecklistItem('b', 'card', 'first');
    const { body } = parseFrontmatter(fs.readFile('boards/b/01-card.md')!);
    assert.strictEqual(
      body,
      '# Card\n\nSome desc.\n\n## Checklist\n\n- [ ] first\n\n## Gates\n\n- [x] tests — ok\n\n## Comments\n\n- **a** (t): hi\n',
    );
  });

  test('creates the section at the end of the body when there are no other sections', () => {
    const { fs, store } = makeStore({
      'boards/b/.config.json': configJson(['todo']),
      'boards/b/01-card.md': '# Card\n\nSome desc.\n',
    });
    store.addChecklistItem('b', 'card', 'first');
    const { body } = parseFrontmatter(fs.readFile('boards/b/01-card.md')!);
    assert.strictEqual(body, '# Card\n\nSome desc.\n\n## Checklist\n\n- [ ] first\n');
  });

  test('stamps updatedAt', () => {
    const { fs, store } = makeStore({
      'boards/b/.config.json': configJson(['todo']),
      'boards/b/01-card.md': '# Card\n',
    });
    store.addChecklistItem('b', 'card', 'x');
    const { data } = parseFrontmatter(fs.readFile('boards/b/01-card.md')!);
    assert.strictEqual(data['updatedAt'], '2026-01-01T00:00:00.000Z');
  });

  test('unknown card returns false and writes nothing', () => {
    const { fs, store } = makeStore({
      'boards/b/.config.json': configJson(['todo']),
      'boards/b/01-card.md': '# Card\n',
    });
    const before = fs.snapshot();
    assert.strictEqual(store.addChecklistItem('b', 'ghost', 'x'), false);
    assert.deepStrictEqual(fs.snapshot(), before);
  });

  test('fires listeners once', () => {
    const { store } = makeStore({
      'boards/b/.config.json': configJson(['todo']),
      'boards/b/01-card.md': '# Card\n',
    });
    let fired = 0;
    store.onDidChange(() => fired++);
    store.addChecklistItem('b', 'card', 'x');
    store.addChecklistItem('b', 'ghost', 'x');
    assert.strictEqual(fired, 1);
  });
});

describe('store.setCardDescription', () => {
  test('replaces the description span and preserves other sections byte-for-byte', () => {
    const { fs, store } = makeStore({
      'boards/b/.config.json': configJson(['todo']),
      'boards/b/01-card.md': '# Card\n\nOld desc.\n\n## Checklist\n\n- [ ] one\n',
    });
    const ok = store.setCardDescription('b', 'card', 'New desc.');
    assert.strictEqual(ok, true);
    const { body } = parseFrontmatter(fs.readFile('boards/b/01-card.md')!);
    assert.strictEqual(body, '# Card\n\nNew desc.\n\n## Checklist\n\n- [ ] one\n');
  });

  test('trims the text and preserves internal paragraph breaks', () => {
    const { fs, store } = makeStore({
      'boards/b/.config.json': configJson(['todo']),
      'boards/b/01-card.md': '# Card\n\n## Checklist\n\n- [ ] one\n',
    });
    store.setCardDescription('b', 'card', '  Para one.\n\nPara two.  ');
    const { body } = parseFrontmatter(fs.readFile('boards/b/01-card.md')!);
    assert.strictEqual(body, '# Card\n\nPara one.\n\nPara two.\n\n## Checklist\n\n- [ ] one\n');
  });

  test('empty text removes the description entirely', () => {
    const { fs, store } = makeStore({
      'boards/b/.config.json': configJson(['todo']),
      'boards/b/01-card.md': '# Card\n\nOld desc.\n\n## Checklist\n\n- [ ] one\n',
    });
    store.setCardDescription('b', 'card', '');
    const { body } = parseFrontmatter(fs.readFile('boards/b/01-card.md')!);
    assert.strictEqual(body, '# Card\n\n## Checklist\n\n- [ ] one\n');
    assert.strictEqual(store.getBoard('b')?.cards['card']?.desc, undefined);
  });

  test('sets a description when there was none, without touching the checklist', () => {
    const { fs, store } = makeStore({
      'boards/b/.config.json': configJson(['todo']),
      'boards/b/01-card.md': '# Card\n\n## Checklist\n\n- [ ] one\n',
    });
    store.setCardDescription('b', 'card', 'Fresh desc.');
    const { body } = parseFrontmatter(fs.readFile('boards/b/01-card.md')!);
    assert.strictEqual(body, '# Card\n\nFresh desc.\n\n## Checklist\n\n- [ ] one\n');
  });

  test('given a description holding a ## Sub heading, when it is read and written straight back, then the file is byte-identical', () => {
    // The reader and the writer must bound the description at the SAME
    // headings. When the writer stopped at any `## `, `describe` wrote back
    // exactly what `show` printed and duplicated every custom section.
    const body =
      '# Card\n\nIntro.\n\n## Sub\n\nDetail.\n\n## Checklist\n\n- [ ] one\n\n## Comments\n\n- **a** (t): hi\n';
    const { fs, store } = makeStore({
      'boards/b/.config.json': configJson(['todo']),
      'boards/b/01-card.md': `---\ncolumn: todo\n---\n${body}`,
    });
    const shown = required(
      required(store.getBoard('b'), 'board').cards['card']?.desc,
      'the description',
    );
    assert.strictEqual(shown, 'Intro.\n\n## Sub\n\nDetail.', 'the custom section is described');
    store.setCardDescription('b', 'card', shown);
    assert.strictEqual(
      parseFrontmatter(required(fs.readFile('boards/b/01-card.md'), 'card file')).body,
      body,
      'describe -> show -> describe must not change one byte of the body',
    );
    // And it stays a fixed point: a second round adds nothing either.
    store.setCardDescription('b', 'card', shown);
    assert.strictEqual(
      parseFrontmatter(required(fs.readFile('boards/b/01-card.md'), 'card file')).body,
      body,
    );
  });

  test('a body with no # heading treats the top of the body as the description', () => {
    const { fs, store } = makeStore({
      'boards/b/.config.json': configJson(['todo']),
      'boards/b/01-card.md': '## Checklist\n\n- [ ] one\n',
    });
    store.setCardDescription('b', 'card', 'Inserted desc.');
    const { body } = parseFrontmatter(fs.readFile('boards/b/01-card.md')!);
    assert.strictEqual(body, 'Inserted desc.\n\n## Checklist\n\n- [ ] one\n');
  });

  test('stamps updatedAt', () => {
    const { fs, store } = makeStore({
      'boards/b/.config.json': configJson(['todo']),
      'boards/b/01-card.md': '# Card\n',
    });
    store.setCardDescription('b', 'card', 'x');
    const { data } = parseFrontmatter(fs.readFile('boards/b/01-card.md')!);
    assert.strictEqual(data['updatedAt'], '2026-01-01T00:00:00.000Z');
  });

  test('unknown card returns false and writes nothing', () => {
    const { fs, store } = makeStore({
      'boards/b/.config.json': configJson(['todo']),
      'boards/b/01-card.md': '# Card\n',
    });
    const before = fs.snapshot();
    assert.strictEqual(store.setCardDescription('b', 'ghost', 'x'), false);
    assert.deepStrictEqual(fs.snapshot(), before);
  });

  test('fires listeners once', () => {
    const { store } = makeStore({
      'boards/b/.config.json': configJson(['todo']),
      'boards/b/01-card.md': '# Card\n',
    });
    let fired = 0;
    store.onDidChange(() => fired++);
    store.setCardDescription('b', 'card', 'x');
    store.setCardDescription('b', 'ghost', 'x');
    assert.strictEqual(fired, 1);
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
