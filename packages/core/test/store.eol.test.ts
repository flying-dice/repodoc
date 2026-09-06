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
    { id: 'todo', name: 'To Do', color: '#000' },
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
