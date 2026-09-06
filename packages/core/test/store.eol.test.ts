/**
 * Line endings survive every mutation. RepoDoc edits files a human also edits:
 * silently converting a CRLF file to LF (or the reverse) turns a one-line change
 * into a whole-file diff, and hides the real edit in a review.
 */

import { describe, test } from 'bun:test';
import * as assert from 'node:assert';
import { detectEol } from '../src/eol';
import { makeStore, required } from './helpers';

const CONFIG = JSON.stringify({
  name: 'Board',
  columns: [
    // `tests` is declared so evidence may be recorded for it; on `todo`'s ENTER,
    // where it cannot gate the todo -> done moves exercised below.
    { id: 'todo', name: 'To Do', color: '#000', enter: [{ id: 'tests', script: 'bun test' }] },
    { id: 'done', name: 'Done', color: '#000' },
  ],
  labels: {},
  fields: [{ id: 'note', type: 'text' }],
});

const CRLF_CARD = '---\r\ncolumn: todo\r\n---\r\n# Card\r\n\r\nDesc.\r\n';
const LF_CARD = '---\ncolumn: todo\n---\n# Card\n\nDesc.\n';

/** Every card mutation the store offers, applied to `slug`. */
const MUTATIONS: Array<[string, (store: ReturnType<typeof makeStore>['store']) => void]> = [
  ['updateCardMeta', (s) => s.updateCardMeta('b', 'card', { priority: 'low' })],
  ['setCardDescription', (s) => s.setCardDescription('b', 'card', 'New description.')],
  ['addChecklistItem', (s) => s.addChecklistItem('b', 'card', 'an item')],
  ['toggleChecklistItem', (s) => s.toggleChecklistItem('b', 'card', 0)],
  ['addComment', (s) => s.addComment('b', 'card', 'tester', 'a note')],
  ['recordGateEvidence', (s) => s.recordGateEvidence('b', 'card', 'tests', 'green', 'tester')],
  ['recordGateOverride', (s) => s.recordGateOverride('b', 'card', 'g', 'tester', 'why')],
  ['setCardField', (s) => s.setCardField('b', 'card', 'note', 'hello')],
  ['moveCard', (s) => s.moveCard('b', 'card', 'done', 0)],
  ['moveCardGated', (s) => s.moveCardGated('b', 'card', 'done', 0)],
  // Text arguments may themselves arrive with CRLF — from a Windows editor, a
  // clipboard, or a webview. The body is edited in LF and written back with the
  // file's own endings, so a CR that survives into it comes out as `\r\r\n`.
  [
    'setCardDescription (CRLF in the text)',
    (s) => s.setCardDescription('b', 'card', 'line one\r\nline two'),
  ],
  ['addComment (CRLF in the text)', (s) => s.addComment('b', 'card', 'tester', 'one\r\ntwo')],
  ['addChecklistItem (CRLF in the text)', (s) => s.addChecklistItem('b', 'card', 'one\r\ntwo')],
];

/** The single card file in board `b`, whatever it is numbered. */
function readCard(fs: ReturnType<typeof makeStore>['fs']): string {
  const name = fs
    .listDir('boards/b')
    .map((e) => e.name)
    .find((n) => n.endsWith('.md'));
  return required(
    name === undefined ? undefined : fs.readFile(`boards/b/${name}`),
    'the card file',
  );
}

describe('store — line endings', () => {
  for (const [name, mutate] of MUTATIONS) {
    test(`given a CRLF card, when ${name} runs, then every line still ends CRLF`, () => {
      const { fs, store } = makeStore({
        'boards/b/.config.json': CONFIG,
        // A checklist so toggleChecklistItem has something to flip.
        'boards/b/01-card.md': `${CRLF_CARD}\r\n## Checklist\r\n\r\n- [ ] one\r\n`,
      });
      mutate(store);
      const after = readCard(fs);
      assert.strictEqual(detectEol(after), '\r\n');
      assert.ok(
        !/[^\r]\n/.test(after),
        `no line may be left with a bare LF after ${name}, file is:\n${JSON.stringify(after)}`,
      );
    });

    test(`given an LF card, when ${name} runs, then no carriage return appears`, () => {
      const { fs, store } = makeStore({
        'boards/b/.config.json': CONFIG,
        'boards/b/01-card.md': `${LF_CARD}\n## Checklist\n\n- [ ] one\n`,
      });
      mutate(store);
      assert.ok(!readCard(fs).includes('\r'), `${name} must not introduce a CR`);
    });
  }

  test('given an LF card, when CRLF text is written, then no lone CR is left inside the body', () => {
    const { fs, store } = makeStore({
      'boards/b/.config.json': CONFIG,
      'boards/b/01-card.md': LF_CARD,
    });
    store.setCardDescription('b', 'card', 'line one\r\nline two');
    store.addComment('b', 'card', 'tester', 'said one\r\nsaid two');
    const after = readCard(fs);
    assert.ok(!after.includes('\r'), `an LF card must stay CR-free, file is:\n${after}`);
    assert.ok(after.includes('line one\nline two'), 'the paragraph survives as two lines');
  });

  test('given a CRLF card, when CRLF text is written, then no line ends \\r\\r\\n', () => {
    const { fs, store } = makeStore({
      'boards/b/.config.json': CONFIG,
      'boards/b/01-card.md': CRLF_CARD,
    });
    store.setCardDescription('b', 'card', 'line one\r\nline two');
    store.addComment('b', 'card', 'tester', 'said one\r\nsaid two');
    const after = readCard(fs);
    assert.ok(!after.includes('\r\r'), `no doubled CR may appear, file is:\n${after}`);
    assert.ok(!/[^\r]\n/.test(after), 'every line still ends CRLF');
    assert.strictEqual(
      required(store.getBoard('b'), 'board').cards['card']?.desc,
      'line one\nline two',
      'the description reads back without a stray CR',
    );
  });

  test('given a CRLF card, when it is read, then the parsed body and title are CR-free', () => {
    const { store } = makeStore({
      'boards/b/.config.json': CONFIG,
      'boards/b/01-card.md': CRLF_CARD,
    });
    const card = required(required(store.getBoard('b'), 'board').cards['card'], 'card');
    assert.strictEqual(card.title, 'Card');
    assert.strictEqual(card.desc, 'Desc.');
  });
});

describe('detectEol', () => {
  test('picks the dominant ending, defaulting to LF', () => {
    assert.strictEqual(detectEol(''), '\n');
    assert.strictEqual(detectEol('no newline at all'), '\n');
    assert.strictEqual(detectEol('a\nb\n'), '\n');
    assert.strictEqual(detectEol('a\r\nb\r\n'), '\r\n');
    assert.strictEqual(detectEol('a\r\nb\r\nc\n'), '\r\n', 'mixed: the majority wins');
    assert.strictEqual(detectEol('a\r\nb\nc\n'), '\n', 'a tie or LF majority stays LF');
  });
});
