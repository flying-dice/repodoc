/**
 * Adversarial coverage for the card-mutating store surfaces: updateCardMeta,
 * addChecklistItem, setCardDescription, recordGateEvidence/Override,
 * cardRef/cardFilePath and the addCard/moveCard results.
 *
 * Every test asserts the BYTES that land on disk, not just the return value —
 * these methods all claim to preserve every other byte of the card file.
 *
 * Tests marked `test.skip` are failing tests for defects reported to the lead;
 * they are skipped only so the suite stays green, and they assert the contract
 * as written, never the current (wrong) behaviour.
 */

import { describe, test } from 'bun:test';
import * as assert from 'node:assert';
import { defaultColumns } from '../src/boardConfig';
import { parseFrontmatter } from '../src/frontmatter';
import { makeStore, required } from './helpers';

const CONFIG = JSON.stringify({
  name: 'Board',
  columns: [
    { id: 'todo', name: 'To Do', color: '#000' },
    { id: 'done', name: 'Done', color: '#000' },
  ],
  labels: {},
  fields: [],
});

/** A board with one card whose body is exactly `body`. */
function withCard(body: string, frontmatter = 'column: todo'): ReturnType<typeof makeStore> {
  return makeStore({
    'boards/b/.config.json': CONFIG,
    'boards/b/01-card.md': `---\n${frontmatter}\n---\n${body}`,
  });
}

const STAMP = '2026-01-01T00:00:00.000Z';
const CARD = 'boards/b/01-card.md';

/** The whole card file, or a failing assertion naming the missing file. */
function read(fs: ReturnType<typeof makeStore>['fs'], path = CARD): string {
  return required(fs.readFile(path), `file ${path}`);
}

describe('store.updateCardMeta — adversarial', () => {
  test('given a body with no heading, when the title is patched, then a heading is inserted above the body', () => {
    const { fs, store } = withCard('Just prose, no heading.\n');
    assert.strictEqual(store.updateCardMeta('b', 'card', { title: 'Fresh' }), true);
    assert.strictEqual(
      read(fs),
      `---\ncolumn: todo\nupdatedAt: ${STAMP}\n---\n# Fresh\n\nJust prose, no heading.\n`,
    );
  });

  test('given a title carrying newlines and tabs, when patched, then the heading is one collapsed line', () => {
    const { fs, store } = withCard('# Old\n\nBody.\n');
    store.updateCardMeta('b', 'card', { title: '  Ship\tthe\nCLI  ' });
    assert.strictEqual(
      read(fs),
      `---\ncolumn: todo\nupdatedAt: ${STAMP}\n---\n# Ship the CLI\n\nBody.\n`,
    );
  });

  test('given a non-ASCII title, when patched, then the heading keeps every character verbatim', () => {
    const { fs, store } = withCard('# Old\n');
    store.updateCardMeta('b', 'card', { title: 'Ünïcode — 日本語' });
    assert.ok(read(fs).includes('# Ünïcode — 日本語\n'));
  });

  test('given an unknown card, when meta is patched, then it returns false and writes nothing', () => {
    const { fs, store } = withCard('# Card\n');
    const before = fs.snapshot();
    assert.strictEqual(store.updateCardMeta('b', 'nope', { title: 'x' }), false);
    assert.strictEqual(store.updateCardMeta('nope', 'card', { title: 'x' }), false);
    assert.deepStrictEqual(fs.snapshot(), before);
  });

  test('given an empty patch, when applied, then only updatedAt is stamped and every other byte survives', () => {
    const { fs, store } = withCard('# Card\n\nBody.\n', 'column: todo\nlabels: [a, b]');
    assert.strictEqual(store.updateCardMeta('b', 'card', {}), true);
    assert.strictEqual(
      read(fs),
      `---\ncolumn: todo\nlabels: [a, b]\nupdatedAt: ${STAMP}\n---\n# Card\n\nBody.\n`,
    );
  });

  test('given null for labels and priority, when patched, then those keys are removed and the body is untouched', () => {
    const { fs, store } = withCard(
      '# Card\n\nBody.\n',
      'column: todo\nlabels: [a]\npriority: high',
    );
    store.updateCardMeta('b', 'card', { labels: null, priority: null });
    assert.strictEqual(read(fs), `---\ncolumn: todo\nupdatedAt: ${STAMP}\n---\n# Card\n\nBody.\n`);
  });

  test('given an empty labels array, when patched, then an empty list is written (only null removes)', () => {
    const { fs, store } = withCard('# Card\n');
    store.updateCardMeta('b', 'card', { labels: [] });
    const { data } = parseFrontmatter(read(fs));
    assert.deepStrictEqual(data['labels'], []);
    assert.strictEqual(required(store.getBoard('b'), 'board').cards['card']?.labels, undefined);
  });

  test('given progress outside 0-100, when patched, then the store writes it unvalidated (hosts validate)', () => {
    const { fs, store } = withCard('# Card\n');
    store.updateCardMeta('b', 'card', { progress: 150 });
    assert.ok(read(fs).includes('progress: 150\n'));
  });

  test('given live false, when patched, then the key is written as false rather than removed', () => {
    // The CLI maps `--live false` to null (removal); the store itself keeps a
    // literal false, which cardParse then ignores (only `true` is live).
    const { fs, store } = withCard('# Card\n');
    store.updateCardMeta('b', 'card', { live: false });
    assert.ok(read(fs).includes('live: false\n'));
    assert.strictEqual(required(store.getBoard('b'), 'board').cards['card']?.live, undefined);
  });

  test('given a status value containing a --- line, when patched, then the frontmatter block stays intact', () => {
    // Frontmatter is one `key: value` per line, so a newline in a value could
    // otherwise forge keys or close the block early. The patch must be collapsed
    // to a single line before it is serialized.
    const { fs, store } = withCard('# Card\n\nBody.\n');
    store.updateCardMeta('b', 'card', { status: 'ok\n---\ninjected: yes' });
    const { data, body } = parseFrontmatter(read(fs));
    assert.strictEqual(data['updatedAt'], STAMP, 'updatedAt must survive the write');
    assert.strictEqual(data['injected'], undefined, 'the value must not become frontmatter keys');
    assert.strictEqual(body, '# Card\n\nBody.\n', 'the body must not absorb frontmatter lines');
  });

  test('given a CRLF card file, when meta is patched, then the file keeps its CRLF line endings', () => {
    const { fs, store } = makeStore({
      'boards/b/.config.json': CONFIG,
      'boards/b/01-card.md': '---\r\ncolumn: todo\r\n---\r\n# Card\r\n\r\nBody.\r\n',
    });
    store.updateCardMeta('b', 'card', { priority: 'low' });
    assert.ok(read(fs).includes('# Card\r\n'), 'body line endings must be preserved');
  });
});

describe('store.setCardField — adversarial', () => {
  const FIELD_CONFIG = JSON.stringify({
    name: 'Board',
    columns: [{ id: 'todo', name: 'To Do', color: '#000' }],
    labels: {},
    fields: [{ id: 'note', type: 'text' }],
  });

  test('given a field value containing a --- line, when set, then the frontmatter block stays intact', () => {
    const { fs, store } = makeStore({
      'boards/b/.config.json': FIELD_CONFIG,
      'boards/b/01-card.md': '---\ncolumn: todo\n---\n# Card\n\nBody.\n',
    });
    store.setCardField('b', 'card', 'note', 'ok\n---\ncolumn: done');
    const { data, body } = parseFrontmatter(read(fs));
    assert.strictEqual(data['column'], 'todo', 'a field value must not forge the column key');
    assert.strictEqual(body, '# Card\n\nBody.\n');
  });

  test('given an undeclared field, when set, then nothing is written', () => {
    const { fs, store } = makeStore({
      'boards/b/.config.json': FIELD_CONFIG,
      'boards/b/01-card.md': '---\ncolumn: todo\n---\n# Card\n',
    });
    const before = fs.snapshot();
    store.setCardField('b', 'card', 'nope', 'x');
    store.setCardField('b', 'card', 'note', 42);
    assert.deepStrictEqual(fs.snapshot(), before, 'unknown field and wrong type are both no-ops');
  });
});

describe('store.addChecklistItem — adversarial', () => {
  test('given Gates and Comments but no Checklist, when an item is added, then the section lands before Gates', () => {
    const { fs, store } = withCard(
      '# Card\n\nDesc.\n\n## Gates\n\n- [x] tests — ok\n\n## Comments\n\n- **x** (t): hi\n',
    );
    assert.strictEqual(store.addChecklistItem('b', 'card', 'first'), true);
    assert.strictEqual(
      read(fs),
      `---\ncolumn: todo\nupdatedAt: ${STAMP}\n---\n# Card\n\nDesc.\n\n` +
        '## Checklist\n\n- [ ] first\n\n' +
        '## Gates\n\n- [x] tests — ok\n\n' +
        '## Comments\n\n- **x** (t): hi\n',
    );
  });

  test('given only a Comments section, when an item is added, then the Checklist still lands above it', () => {
    const { fs, store } = withCard('# Card\n\n## Comments\n\n- **x** (t): hi\n');
    store.addChecklistItem('b', 'card', 'first');
    const body = parseFrontmatter(read(fs)).body;
    assert.ok(
      body.indexOf('## Checklist') < body.indexOf('## Comments'),
      `Checklist must precede Comments, got:\n${body}`,
    );
  });

  test('given a Checklist followed by Gates, when an item is added, then it appends after the last item', () => {
    const { fs, store } = withCard(
      '# Card\n\n## Checklist\n\n- [x] one\n\n## Gates\n\n- [x] tests — ok\n',
    );
    store.addChecklistItem('b', 'card', 'two');
    assert.strictEqual(
      read(fs),
      `---\ncolumn: todo\nupdatedAt: ${STAMP}\n---\n# Card\n\n` +
        '## Checklist\n\n- [x] one\n- [ ] two\n\n' +
        '## Gates\n\n- [x] tests — ok\n',
    );
  });

  test('given text with newlines and tabs, when added, then it is collapsed onto one list line', () => {
    const { fs, store } = withCard('# Card\n');
    store.addChecklistItem('b', 'card', '  write\tthe\ndocs  ');
    assert.ok(read(fs).endsWith('## Checklist\n\n- [ ] write the docs\n'));
  });

  test('given an unknown card or board, when an item is added, then it returns false and writes nothing', () => {
    const { fs, store } = withCard('# Card\n');
    const before = fs.snapshot();
    assert.strictEqual(store.addChecklistItem('b', 'nope', 'x'), false);
    assert.strictEqual(store.addChecklistItem('nope', 'card', 'x'), false);
    assert.deepStrictEqual(fs.snapshot(), before);
  });

  test('given an empty checklist item, when a later mutation appends a section, then the item survives', () => {
    // An empty item is refused outright, so the odd `- [ ] ` line is never
    // written; the real item survives the appended Gates section either way.
    const { store } = withCard('# Card\n');
    store.addChecklistItem('b', 'card', 'real');
    assert.strictEqual(store.addChecklistItem('b', 'card', ''), false, 'an empty item is refused');
    assert.strictEqual(store.addChecklistItem('b', 'card', '   '), false);
    const before = required(store.getBoard('b'), 'board').cards['card']?.checklist?.length;
    store.recordGateEvidence('b', 'card', 'tests', 'green', 'tester');
    const after = required(store.getBoard('b'), 'board').cards['card']?.checklist?.length;
    assert.strictEqual(after, before, 'appending a Gates section must not drop a checklist item');
  });

  test('given a body ending in a line with trailing spaces, when a section is appended, then those spaces survive', () => {
    // appendSection may only drop trailing blank LINES — never the trailing
    // space of a content line, which is what an empty task item is made of.
    const { fs, store } = withCard('# Card\n\n## Checklist\n\n- [ ] kept \n\n');
    store.recordGateEvidence('b', 'card', 'tests', 'green', 'tester');
    assert.ok(
      read(fs).includes('- [ ] kept \n\n## Gates\n'),
      `the content line keeps its trailing space, file is:\n${read(fs)}`,
    );
  });

  test('given an empty comment, when added, then it is refused and nothing is written', () => {
    const { fs, store } = withCard('# Card\n');
    const before = fs.snapshot();
    assert.strictEqual(store.addComment('b', 'card', 'tester', '  \n '), false);
    assert.deepStrictEqual(fs.snapshot(), before);
  });
});

describe('store.setCardDescription — adversarial', () => {
  test('given a description followed by sections, when replaced, then only the description changes', () => {
    const { fs, store } = withCard(
      '# Card\n\nold one\nold two\n\n## Checklist\n\n- [ ] keep\n',
      'column: todo\nlabels: [a, b]',
    );
    assert.strictEqual(store.setCardDescription('b', 'card', 'new\n\ntext'), true);
    assert.strictEqual(
      read(fs),
      `---\ncolumn: todo\nlabels: [a, b]\nupdatedAt: ${STAMP}\n---\n# Card\n\nnew\n\ntext\n\n` +
        '## Checklist\n\n- [ ] keep\n',
    );
  });

  test('given whitespace-only text, when set, then the description is removed and the sections stay', () => {
    const { fs, store } = withCard('# Card\n\nold\n\n## Checklist\n\n- [ ] keep\n');
    store.setCardDescription('b', 'card', '   \n  ');
    assert.strictEqual(
      read(fs),
      `---\ncolumn: todo\nupdatedAt: ${STAMP}\n---\n# Card\n\n## Checklist\n\n- [ ] keep\n`,
    );
  });

  test('given a body with no heading, when set, then the whole body becomes the description', () => {
    // Documented: with no `# ` heading the description starts at byte 0, so the
    // previous prose is replaced wholesale.
    const { fs, store } = withCard('prose that is not a heading\n');
    store.setCardDescription('b', 'card', 'replacement');
    assert.strictEqual(read(fs), `---\ncolumn: todo\nupdatedAt: ${STAMP}\n---\nreplacement\n`);
  });

  test('given a description ending without a newline, when set, then the body keeps a trailing newline', () => {
    const { fs, store } = withCard('# Card');
    store.setCardDescription('b', 'card', 'desc');
    assert.strictEqual(read(fs), `---\ncolumn: todo\nupdatedAt: ${STAMP}\n---\n# Card\n\ndesc\n`);
  });

  test('given text holding a ## heading, when set, then it is written verbatim into the description', () => {
    const { fs, store } = withCard('# Card\n\nold\n\n## Gates\n\n- [x] g — ok\n');
    store.setCardDescription('b', 'card', 'intro\n\n## Sub\n\nmore');
    const body = parseFrontmatter(read(fs)).body;
    assert.strictEqual(body, '# Card\n\nintro\n\n## Sub\n\nmore\n\n## Gates\n\n- [x] g — ok\n');
  });

  test('given an unknown card, when a description is set, then it returns false and writes nothing', () => {
    const { fs, store } = withCard('# Card\n');
    const before = fs.snapshot();
    assert.strictEqual(store.setCardDescription('b', 'nope', 'x'), false);
    assert.deepStrictEqual(fs.snapshot(), before);
  });
});

describe('store gate evidence — adversarial', () => {
  test('given no Gates section, when evidence is recorded, then one is appended after the body', () => {
    const { fs, store } = withCard('# Card\n\nDesc.\n');
    assert.strictEqual(store.recordGateEvidence('b', 'card', 'tests', 'green', 'tester'), true);
    assert.strictEqual(
      read(fs),
      `---\ncolumn: todo\nupdatedAt: ${STAMP}\n---\n# Card\n\nDesc.\n\n` +
        `## Gates\n\n- [x] tests — green (tester, ${STAMP})\n`,
    );
  });

  test('given evidence for the same gate, when re-recorded, then the line is replaced in place', () => {
    const { fs, store } = withCard(
      '# Card\n\n## Gates\n\n- [x] tests — old\n- [x] lint — kept\n\n## Comments\n\n- hi\n',
    );
    store.recordGateEvidence('b', 'card', 'tests', 'green', 'tester');
    assert.strictEqual(
      read(fs),
      `---\ncolumn: todo\nupdatedAt: ${STAMP}\n---\n# Card\n\n` +
        `## Gates\n\n- [x] tests — green (tester, ${STAMP})\n- [x] lint — kept\n\n` +
        '## Comments\n\n- hi\n',
    );
  });

  test('given a gate id that prefixes another, when recorded, then only the exact gate line is rewritten', () => {
    const { fs, store } = withCard('# Card\n\n## Gates\n\n- [x] tests-e2e — untouched\n');
    store.recordGateEvidence('b', 'card', 'tests', 'green', 'tester');
    const body = parseFrontmatter(read(fs)).body;
    assert.ok(body.includes('- [x] tests-e2e — untouched\n'), 'the longer gate id is untouched');
    assert.ok(body.includes(`- [x] tests — green (tester, ${STAMP})`), 'the new line is appended');
  });

  test('given a whitespace-only reason, when overriding, then no reason suffix is written', () => {
    const { fs, store } = withCard('# Card\n');
    assert.strictEqual(store.recordGateOverride('b', 'card', 'g', 'tester', '   '), true);
    assert.ok(read(fs).endsWith(`## Gates\n\n- [x] g — OVERRIDDEN (tester, ${STAMP})\n`));
  });

  test('given no reason at all, when overriding, then the line stops after the timestamp', () => {
    const { fs, store } = withCard('# Card\n');
    store.recordGateOverride('b', 'card', 'g', 'tester');
    assert.ok(read(fs).endsWith(`- [x] g — OVERRIDDEN (tester, ${STAMP})\n`));
  });

  test('given a reason with inner double spaces, when overriding, then the reason is written verbatim', () => {
    const { fs, store } = withCard('# Card\n');
    store.recordGateOverride('b', 'card', 'g', 'tester', '  ship  now  ');
    assert.ok(read(fs).endsWith(`- [x] g — OVERRIDDEN (tester, ${STAMP}): ship  now\n`));
  });

  test('given an unknown card, when gate evidence is recorded, then it returns false and writes nothing', () => {
    const { fs, store } = withCard('# Card\n');
    const before = fs.snapshot();
    assert.strictEqual(store.recordGateEvidence('b', 'nope', 'g', 'r', 'w'), false);
    assert.strictEqual(store.recordGateOverride('b', 'nope', 'g', 'w', 'why'), false);
    assert.deepStrictEqual(fs.snapshot(), before);
  });

  test('given a multi-line result, when the same gate is re-recorded, then no orphan line is left', () => {
    const { fs, store } = withCard('# Card\n');
    store.recordGateEvidence('b', 'card', 'tests', 'line1\nline2', 'tester');
    assert.ok(read(fs).includes('- [x] tests — line1 line2 (tester,'), 'the note is one line');
    store.recordGateEvidence('b', 'card', 'tests', 'clean', 'tester');
    assert.ok(!read(fs).includes('line2'), 'stale evidence must not survive a re-record');
  });

  test('given a multi-line reason, when a gate is overridden, then the audit line stays one line', () => {
    const { fs, store } = withCard('# Card\n');
    store.recordGateOverride('b', 'card', 'g', 'tester', 'hotfix\nsecond line');
    store.recordGateOverride('b', 'card', 'g', 'tester', 'final');
    const body = parseFrontmatter(read(fs)).body;
    assert.ok(!body.includes('second line'), `no orphan line may survive, got:\n${body}`);
    assert.ok(body.includes(`- [x] g — OVERRIDDEN (tester, ${STAMP}): final`));
  });

  test('given an empty result, when evidence is recorded, then it is refused and nothing is written', () => {
    const { fs, store } = withCard('# Card\n');
    const before = fs.snapshot();
    assert.strictEqual(store.recordGateEvidence('b', 'card', 'tests', '  ', 'tester'), false);
    assert.deepStrictEqual(fs.snapshot(), before);
  });
});

describe('store.cardRef / cardFilePath — adversarial', () => {
  test('given a card, then the ref is scope/id — title (path) and the path is the real file', () => {
    const { store } = makeStore({
      'boards/b/.config.json': CONFIG,
      'boards/b/007-odd-number.md': '---\ncolumn: todo\n---\n# Odd — Number\n',
    });
    assert.strictEqual(
      store.cardRef('b', 'odd-number'),
      'b/odd-number — Odd — Number (boards/b/007-odd-number.md)',
    );
    assert.strictEqual(store.cardFilePath('b', 'odd-number'), 'boards/b/007-odd-number.md');
  });

  test('given a card whose body has no heading, then the ref falls back to the title-cased slug', () => {
    const { store } = makeStore({
      'boards/b/.config.json': CONFIG,
      'boards/b/01-no-heading.md': '---\ncolumn: todo\n---\nprose\n',
    });
    assert.strictEqual(
      store.cardRef('b', 'no-heading'),
      'b/no-heading — No Heading (boards/b/01-no-heading.md)',
    );
  });

  test('given an unknown card or board, then cardRef and cardFilePath are undefined', () => {
    const { store } = withCard('# Card\n');
    assert.strictEqual(store.cardRef('b', 'nope'), undefined);
    assert.strictEqual(store.cardRef('nope', 'card'), undefined);
    assert.strictEqual(store.cardFilePath('b', 'nope'), undefined);
    assert.strictEqual(store.cardFilePath('nope', 'card'), undefined);
  });
});

describe('store.addCard / moveCard results — adversarial', () => {
  const three = (): ReturnType<typeof makeStore> =>
    makeStore({
      'boards/b/.config.json': CONFIG,
      'boards/b/01-one.md': '---\ncolumn: todo\n---\n# One\n',
      'boards/b/02-two.md': '---\ncolumn: todo\n---\n# Two\n',
      'boards/b/03-three.md': '---\ncolumn: todo\n---\n# Three\n',
    });

  const names = (fs: ReturnType<typeof makeStore>['fs']): string[] =>
    fs
      .listDir('boards/b')
      .filter((e) => e.name.endsWith('.md'))
      .map((e) => e.name)
      .sort();

  test('given a negative index, when moving, then the card lands at the top of the column', () => {
    const { fs, store } = three();
    assert.deepStrictEqual(store.moveCard('b', 'three', 'todo', -5), { ok: true });
    assert.deepStrictEqual(names(fs), ['01-three.md', '02-one.md', '03-two.md']);
  });

  test('given an index past the end, when moving, then the card lands at the bottom', () => {
    const { fs, store } = three();
    store.moveCard('b', 'one', 'todo', 9999);
    assert.deepStrictEqual(names(fs), ['01-two.md', '02-three.md', '03-one.md']);
  });

  test('given an empty target column, when moving, then the card is appended at the global end', () => {
    const { fs, store } = three();
    store.moveCard('b', 'one', 'done', 0);
    assert.deepStrictEqual(names(fs), ['01-two.md', '02-three.md', '03-one.md']);
    assert.ok(read(fs, 'boards/b/03-one.md').includes('column: done\n'));
  });

  test('given duplicate slugs, when moving, then it refuses and not one byte changes', () => {
    const { fs, store } = makeStore({
      'boards/b/.config.json': CONFIG,
      'boards/b/01-dup.md': '---\ncolumn: todo\n---\n# One\n',
      'boards/b/02-dup.md': '---\ncolumn: todo\n---\n# Two\n',
    });
    const before = fs.snapshot();
    assert.deepStrictEqual(store.moveCard('b', 'dup', 'done', 0), {
      ok: false,
      error: { code: 'duplicate-slugs', slug: 'dup' },
    });
    assert.deepStrictEqual(fs.snapshot(), before);
  });

  test('given an unknown column, when moving, then it refuses before touching the card file', () => {
    const { fs, store } = three();
    const before = fs.snapshot();
    assert.deepStrictEqual(store.moveCard('b', 'one', 'nope', 0), {
      ok: false,
      error: { code: 'unknown-column', columnId: 'nope' },
    });
    assert.deepStrictEqual(fs.snapshot(), before);
  });

  test('given an unknown card or board, when moving, then the error names what was missing', () => {
    const { store } = three();
    assert.deepStrictEqual(store.moveCard('b', 'nope', 'todo', 0), {
      ok: false,
      error: { code: 'unknown-card', cardId: 'nope' },
    });
    assert.deepStrictEqual(store.moveCard('nope', 'one', 'todo', 0), {
      ok: false,
      error: { code: 'unknown-board', boardId: 'nope' },
    });
  });

  test('given a title that slugifies to nothing, when added, then the fallback slug is used and collisions suffix', () => {
    const { fs, store } = makeStore({ 'boards/b/.config.json': CONFIG });
    assert.deepStrictEqual(store.addCard('b', 'todo', '日本語'), { ok: true, cardId: 'card' });
    assert.deepStrictEqual(store.addCard('b', 'todo', '   '), { ok: true, cardId: 'card-2' });
    assert.deepStrictEqual(names(fs), ['01-card.md', '02-card-2.md']);
    // The unslugifiable title still survives verbatim in the file.
    assert.ok(read(fs, 'boards/b/01-card.md').endsWith('# 日本語\n'));
  });

  test('given a board with nine cards, when a tenth is added, then numbering widens to two digits only', () => {
    const seed: Record<string, string> = { 'boards/b/.config.json': CONFIG };
    for (let i = 1; i <= 9; i++) {
      seed[`boards/b/0${i}-c${i}.md`] = `---\ncolumn: todo\n---\n# C${i}\n`;
    }
    const { fs, store } = makeStore(seed);
    assert.deepStrictEqual(store.addCard('b', 'todo', 'Tenth'), { ok: true, cardId: 'tenth' });
    assert.ok(names(fs).includes('10-tenth.md'));
    store.moveCard('b', 'tenth', 'todo', 0);
    assert.deepStrictEqual(names(fs).slice(0, 2), ['01-tenth.md', '02-c1.md']);
  });

  test('given an unknown board or column, when adding, then nothing is written', () => {
    const { fs, store } = makeStore({ 'boards/b/.config.json': CONFIG });
    const before = fs.snapshot();
    assert.deepStrictEqual(store.addCard('nope', 'todo', 'x'), {
      ok: false,
      error: { code: 'unknown-board', boardId: 'nope' },
    });
    assert.deepStrictEqual(store.addCard('b', 'nope', 'x'), {
      ok: false,
      error: { code: 'unknown-column', columnId: 'nope' },
    });
    assert.deepStrictEqual(fs.snapshot(), before);
  });

  test('given a board whose config is malformed, then the default columns stand in and the card is visible', () => {
    // Decision 4: zero columns would leave every card invisible, so the board
    // falls back to the default columns and the host warns.
    const { store } = makeStore({
      'boards/b/.config.json': '{ this is not json',
      'boards/b/01-card.md': '---\ncolumn: todo\n---\n# Card\n',
    });
    const board = required(store.getBoard('b'), 'board');
    assert.deepStrictEqual(
      board.columns.map((c) => c.id),
      defaultColumns().map((c) => c.id),
    );
    assert.ok(board.cards['card'], 'the card is still parsed');
    assert.deepStrictEqual(
      required(
        board.columns.find((c) => c.id === 'todo'),
        'todo column',
      ).cardIds,
      ['card'],
      'the card lands in the column its frontmatter names',
    );
    assert.strictEqual(store.cardFilePath('b', 'card'), 'boards/b/01-card.md');
    assert.match(
      required(store.boardConfigWarning('b'), 'config warning'),
      /boards\/b\/\.config\.json is missing or declares no usable columns/,
    );
  });

  test('given a board with no config file at all, then the default columns stand in', () => {
    const { store } = makeStore({ 'boards/b/01-card.md': '---\ncolumn: nope\n---\n# Card\n' });
    const board = required(store.getBoard('b'), 'board');
    assert.strictEqual(board.columns.length, defaultColumns().length);
    // An unknown column still falls back to the first column, so nothing hides.
    assert.deepStrictEqual(required(board.columns[0], 'first column').cardIds, ['card']);
    assert.ok(store.boardConfigWarning('b'), 'the substitution is reported');
  });

  test('given a board whose config is sound, then no warning is produced', () => {
    const { store } = withCard('# Card\n');
    assert.strictEqual(store.boardConfigWarning('b'), undefined);
  });
});
