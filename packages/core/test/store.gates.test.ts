import { describe, test } from 'bun:test';
import * as assert from 'node:assert';
import { makeStore, required } from './helpers';

const STAMP = '2026-01-01T00:00:00.000Z';

function gatedConfig(): string {
  return JSON.stringify({
    name: 'B',
    columns: [
      { id: 'todo', name: 'To Do', color: '#000000' },
      {
        id: 'review',
        name: 'Review',
        color: '#000000',
        enter: [{ id: 'g', field: 'estimate', check: 'nonempty' }],
      },
    ],
    labels: {},
    agents: {},
    fields: [{ id: 'estimate', type: 'number' }],
  });
}

describe('store.evaluateMove', () => {
  function seed(): ReturnType<typeof makeStore> {
    return makeStore({
      'boards/b/.config.json': gatedConfig(),
      'boards/b/01-card.md': '---\ncolumn: todo\n---\n# Card\n',
    });
  }

  test('evaluates the target enter gate live against the card', () => {
    const { store } = seed();
    const before = store.evaluateMove('b', 'card', 'review');
    assert.strictEqual(before.length, 1);
    assert.strictEqual(before[0]?.satisfied, false);
    assert.strictEqual(before[0]?.reason, 'estimate nonempty (currently: unset)');

    store.setCardField('b', 'card', 'estimate', 3);
    const after = store.evaluateMove('b', 'card', 'review');
    assert.strictEqual(after[0]?.satisfied, true);
    assert.strictEqual(after[0]?.reason, 'estimate nonempty (currently: 3)');
  });

  test('a same-column move has no gates', () => {
    const { store } = seed();
    assert.deepStrictEqual(store.evaluateMove('b', 'card', 'todo'), []);
  });

  test('unknown card or column yields no gates', () => {
    const { store } = seed();
    assert.deepStrictEqual(store.evaluateMove('b', 'ghost', 'review'), []);
    assert.deepStrictEqual(store.evaluateMove('b', 'card', 'nope'), []);
  });
});

describe('store.recordGateOverride', () => {
  function seed(body: string): ReturnType<typeof makeStore> {
    return makeStore({
      'boards/b/.config.json': JSON.stringify({
        name: 'B',
        columns: [{ id: 'todo', name: 'To Do', color: '#000000' }],
        labels: {},
        agents: {},
        fields: [],
      }),
      'boards/b/01-card.md': `---\ncolumn: todo\n---\n${body}`,
    });
  }

  test('creates a ## Gates section when the card has none', () => {
    const { fs, store } = seed('# Card\n');
    store.recordGateOverride('b', 'card', 'signoff', 'jonathan');
    assert.strictEqual(
      fs.readFile('boards/b/01-card.md'),
      `---\ncolumn: todo\nupdatedAt: ${STAMP}\n---\n` +
        `# Card\n\n## Gates\n\n- [x] signoff — OVERRIDDEN (jonathan, ${STAMP})\n`,
    );
  });

  test('upserts the gate line in place rather than duplicating it', () => {
    const { fs, store } = seed('# Card\n');
    store.recordGateOverride('b', 'card', 'signoff', 'jonathan');
    store.recordGateOverride('b', 'card', 'signoff', 'alice');
    const content = fs.readFile('boards/b/01-card.md')!;
    assert.strictEqual((content.match(/- \[x\] signoff/g) ?? []).length, 1);
    assert.ok(content.includes(`- [x] signoff — OVERRIDDEN (alice, ${STAMP})`));
  });

  test('appends into an existing section, preserving every other byte', () => {
    const body = '# Card\n\nDesc.\n\n## Gates\n\n- [x] ci — ran\n\n## Checklist\n\n- [ ] a\n';
    const { fs, store } = seed(body);
    store.recordGateOverride('b', 'card', 'signoff', 'jonathan');
    assert.strictEqual(
      fs.readFile('boards/b/01-card.md'),
      `---\ncolumn: todo\nupdatedAt: ${STAMP}\n---\n` +
        '# Card\n\nDesc.\n\n## Gates\n\n- [x] ci — ran\n' +
        `- [x] signoff — OVERRIDDEN (jonathan, ${STAMP})\n\n` +
        '## Checklist\n\n- [ ] a\n',
    );
  });

  test('an unknown card is a silent no-op', () => {
    const { fs, store } = seed('# Card\n');
    const before = fs.snapshot();
    store.recordGateOverride('b', 'ghost', 'signoff', 'jonathan');
    assert.deepStrictEqual(fs.snapshot(), before);
  });
});

describe('store.addComment', () => {
  function seed(body: string): ReturnType<typeof makeStore> {
    return makeStore({
      'boards/b/.config.json': JSON.stringify({
        name: 'B',
        columns: [{ id: 'todo', name: 'To Do', color: '#000000' }],
        labels: {},
        agents: {},
        fields: [],
      }),
      'boards/b/01-card.md': `---\ncolumn: todo\n---\n${body}`,
    });
  }

  test('creates a ## Comments section when the card has none and stamps updatedAt', () => {
    const { fs, store } = seed('# Card\n');
    store.addComment('b', 'card', 'jonathan', 'First note.');
    assert.strictEqual(
      fs.readFile('boards/b/01-card.md'),
      `---\ncolumn: todo\nupdatedAt: ${STAMP}\n---\n` +
        `# Card\n\n## Comments\n\n- **jonathan** (${STAMP}): First note.\n`,
    );
  });

  test('creates the ## Comments section after an existing ## Gates section', () => {
    const { fs, store } = seed('# Card\n\n## Gates\n\n- [x] ci — ran\n');
    store.addComment('b', 'card', 'claude', 'Looks good.');
    assert.strictEqual(
      fs.readFile('boards/b/01-card.md'),
      `---\ncolumn: todo\nupdatedAt: ${STAMP}\n---\n` +
        '# Card\n\n## Gates\n\n- [x] ci — ran\n\n' +
        `## Comments\n\n- **claude** (${STAMP}): Looks good.\n`,
    );
  });

  test('appends into an existing section rather than duplicating it', () => {
    const { fs, store } = seed('# Card\n');
    store.addComment('b', 'card', 'jonathan', 'first');
    store.addComment('b', 'card', 'claude', 'second');
    assert.strictEqual(
      fs.readFile('boards/b/01-card.md'),
      `---\ncolumn: todo\nupdatedAt: ${STAMP}\n---\n` +
        `# Card\n\n## Comments\n\n` +
        `- **jonathan** (${STAMP}): first\n` +
        `- **claude** (${STAMP}): second\n`,
    );
  });

  test('writes multi-line text with continuation lines indented two spaces', () => {
    const { fs, store } = seed('# Card\n');
    store.addComment('b', 'card', 'claude', 'line one\nline two\nline three');
    assert.strictEqual(
      fs.readFile('boards/b/01-card.md'),
      `---\ncolumn: todo\nupdatedAt: ${STAMP}\n---\n` +
        `# Card\n\n## Comments\n\n` +
        `- **claude** (${STAMP}): line one\n  line two\n  line three\n`,
    );
  });

  test('the appended entry round-trips through the parser', () => {
    const { store } = seed('# Card\n');
    store.addComment('b', 'card', 'claude', 'hello world');
    const card = required(store.getBoard('b')?.cards['card'], 'card');
    assert.deepStrictEqual(card.comments, [{ who: 'claude', at: STAMP, text: 'hello world' }]);
  });

  test('an unknown card is a silent no-op', () => {
    const { fs, store } = seed('# Card\n');
    const before = fs.snapshot();
    store.addComment('b', 'ghost', 'jonathan', 'note');
    assert.deepStrictEqual(fs.snapshot(), before);
  });
});

describe('store.recordGateOverride — reason', () => {
  test('appends the reason after the stamp when given', () => {
    const { fs, store } = makeStore({
      'boards/b/.config.json': gatedConfig(),
      'boards/b/01-card.md': '---\ncolumn: todo\n---\n# Card\n',
    });
    store.recordGateOverride('b', 'card', 'g', 'jon', 'hotfix');
    assert.ok(
      fs.readFile('boards/b/01-card.md')!.includes(`- [x] g — OVERRIDDEN (jon, ${STAMP}): hotfix`),
    );
    store.recordGateOverride('b', 'card', 'g', 'jon');
    assert.ok(
      fs.readFile('boards/b/01-card.md')!.includes(`- [x] g — OVERRIDDEN (jon, ${STAMP})\n`),
    );
  });
});
