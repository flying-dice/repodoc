import { describe, test } from 'bun:test';
import * as assert from 'node:assert';
import { findComments, findGates, parseCard } from '../src/cardParse';
import type { CustomFieldDef } from '../src/types';

const FIELDS: CustomFieldDef[] = [
  { id: 'estimate', type: 'number' },
  { id: 'sev', type: 'select', options: ['low', 'high'] },
  { id: 'tags', type: 'multiselect' },
  { id: 'flag', type: 'boolean' },
  { id: 'due', type: 'date' },
  { id: 'note', type: 'text' },
];

function card(frontmatter: string, body = '# Card\n'): ReturnType<typeof parseCard>['card'] {
  return parseCard('01-card.md', `---\n${frontmatter}\n---\n${body}`, FIELDS).card;
}

describe('cardParse — custom field coercion', () => {
  test('coerces each type; keeps select values outside options; lifts lone multiselect string', () => {
    const c = card(
      [
        'column: todo',
        'estimate: 3',
        'sev: critical', // not in options — kept verbatim
        'tags: urgent', // lone string — becomes a one-item array
        'flag: true',
        'due: 2026-07-17',
        'note: hello',
      ].join('\n'),
    );
    assert.deepStrictEqual(c.custom, {
      estimate: 3,
      sev: 'critical',
      tags: ['urgent'],
      flag: true,
      due: '2026-07-17',
      note: 'hello',
    });
  });

  test('multiselect from an inline array keeps the string members', () => {
    const c = card('tags: [a, b, c]');
    assert.deepStrictEqual(c.custom, { tags: ['a', 'b', 'c'] });
  });

  test('wrong-typed values are dropped, leaving no custom object', () => {
    const c = card(['estimate: not-a-number', 'flag: yes', 'note: 7'].join('\n'));
    // note: 7 parses to a number, so the text field rejects it too.
    assert.strictEqual(c.custom, undefined);
  });

  test('undefined field defs adopt nothing', () => {
    const c = parseCard('01-card.md', '---\nestimate: 3\n---\n# Card\n', []).card;
    assert.strictEqual(c.custom, undefined);
  });
});

describe('cardParse — gates evidence', () => {
  const body =
    '# Card\n' +
    '\n' +
    'Desc line.\n' +
    '\n' +
    '## Gates\n' +
    '\n' +
    '- [ ] tests\n' +
    '- [x] approve — approved (jonathan, 2026-07-17)\n' +
    '- [X] lint\n' +
    '\n' +
    '## Checklist\n' +
    '\n' +
    '- [ ] first\n';

  test('parses ids, done state (incl. uppercase X), and notes', () => {
    const c = card('column: todo', body);
    assert.deepStrictEqual(c.gates, [
      { gateId: 'tests', done: false },
      { gateId: 'approve', done: true, note: 'approved (jonathan, 2026-07-17)' },
      { gateId: 'lint', done: true },
    ]);
  });

  test('description stops at ## Gates and the checklist is still parsed', () => {
    const c = card('column: todo', body);
    assert.strictEqual(c.desc, 'Desc line.');
    assert.deepStrictEqual(c.checklist, [{ text: 'first', done: false }]);
  });

  test('findGates reports the body line indices of each evidence line', () => {
    const { items, indices } = findGates(body);
    assert.strictEqual(items.length, 3);
    // Lines 6/7/8 (0-based) hold the three evidence rows.
    assert.deepStrictEqual(indices, [6, 7, 8]);
  });

  test('a card with no gates section has no gates', () => {
    const c = card('column: todo', '# Card\n\nJust text.\n');
    assert.strictEqual(c.gates, undefined);
  });
});

describe('cardParse — comments journal', () => {
  test('parses who / at / text from the full bold-token format', () => {
    const body =
      '# Card\n\n## Comments\n\n' +
      '- **jonathan** (2026-07-17T10:00:00.000Z): Kicked off the work.\n' +
      '- **claude** (2026-07-17T11:00:00.000Z): Edited src/core/store.ts:12.\n';
    const c = card('column: todo', body);
    assert.deepStrictEqual(c.comments, [
      { who: 'jonathan', at: '2026-07-17T10:00:00.000Z', text: 'Kicked off the work.' },
      { who: 'claude', at: '2026-07-17T11:00:00.000Z', text: 'Edited src/core/store.ts:12.' },
    ]);
  });

  test('tolerates plain-text items (who/at undefined, whole item is text)', () => {
    const body = '# Card\n\n## Comments\n\n- just a plain note\n- **bob** left without a colon\n';
    const c = card('column: todo', body);
    assert.deepStrictEqual(c.comments, [
      { text: 'just a plain note' },
      { who: 'bob', text: 'left without a colon' },
    ]);
  });

  test('a bold+paren item without a colon still splits who/at from text', () => {
    const body = '# Card\n\n## Comments\n\n- **ann** (t1) no colon here\n';
    const c = card('column: todo', body);
    assert.deepStrictEqual(c.comments, [{ who: 'ann', at: 't1', text: 'no colon here' }]);
  });

  test('continuation lines indented 2+ spaces join onto the previous entry', () => {
    const body =
      '# Card\n\n## Comments\n\n' +
      '- **claude** (t1): line one\n' +
      '  line two\n' +
      '  line three\n' +
      '- **claude** (t2): standalone\n';
    const c = card('column: todo', body);
    assert.deepStrictEqual(c.comments, [
      { who: 'claude', at: 't1', text: 'line one\nline two\nline three' },
      { who: 'claude', at: 't2', text: 'standalone' },
    ]);
  });

  test('a blank line ends the current entry', () => {
    const body = '# Card\n\n## Comments\n\n- **a** (t): first\n\n- **b** (t): second\n';
    const c = card('column: todo', body);
    assert.deepStrictEqual(c.comments, [
      { who: 'a', at: 't', text: 'first' },
      { who: 'b', at: 't', text: 'second' },
    ]);
  });

  test('the comments section ends at the next heading', () => {
    const body = '# Card\n\n## Comments\n\n- **a** (t): note\n\n## Checklist\n\n- [ ] x\n';
    const c = card('column: todo', body);
    assert.deepStrictEqual(c.comments, [{ who: 'a', at: 't', text: 'note' }]);
    assert.deepStrictEqual(c.checklist, [{ text: 'x', done: false }]);
  });

  test('a card with no comments section has no comments', () => {
    const c = card('column: todo', '# Card\n\nJust text.\n');
    assert.strictEqual(c.comments, undefined);
  });

  test('a frontmatter comments number is ignored (no comments parsed from it)', () => {
    const c = card('column: todo\ncomments: 5', '# Card\n\nJust text.\n');
    assert.strictEqual(c.comments, undefined);
  });

  test('description stops at ## Comments', () => {
    const body = '# Card\n\nDesc line.\n\n## Comments\n\n- **a** (t): hi\n';
    const c = card('column: todo', body);
    assert.strictEqual(c.desc, 'Desc line.');
  });
});

describe('cardParse comments — round-trip edge cases (review-gate fixes)', () => {
  test('multi-paragraph entries survive a blank paragraph break', () => {
    const body = [
      '# T',
      '',
      '## Comments',
      '',
      '- **claude** (2026-07-17T01:00:00Z): para one',
      '',
      '  para two',
      '',
    ].join('\n');
    const entries = findComments(body);
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0]?.text, 'para one\n\npara two');
  });

  test('an indented dash is a bullet inside the entry, not a new entry', () => {
    const body = [
      '# T',
      '',
      '## Comments',
      '',
      '- **claude** (2026-07-17T01:00:00Z): summary',
      '  - bullet detail',
      '',
    ].join('\n');
    const entries = findComments(body);
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0]?.text, 'summary\n- bullet detail');
  });
});
