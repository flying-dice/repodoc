/**
 * Adversarial coverage for decision records (`decisions.ts`): setStatus with and
 * without frontmatter, frontmatter carrying other keys, bodies that contain
 * `---`, and the parsing fallbacks.
 *
 * The contract is explicit — "the body is preserved byte-for-byte" — so these
 * tests compare whole files, not fields.
 *
 * `test.skip` marks a failing test for a defect reported to the lead.
 */

import { describe, test } from 'bun:test';
import * as assert from 'node:assert';
import { parseDecisionText } from '../src/decisions';
import { makeStore, required } from './helpers';

const read = (fs: ReturnType<typeof makeStore>['fs'], file: string): string =>
  required(fs.readFile(`decisions/${file}`), `decisions/${file}`);

describe('store.setDecisionStatus — adversarial', () => {
  test('given a file with no frontmatter, when the status is set, then a block is prepended and the body is untouched', () => {
    const body = '# Decision 01 — Plain\n\nBody with a --- inside it.\n\n---\n\nMore prose.\n';
    const { fs, store } = makeStore({ 'decisions/01-plain.md': body });
    assert.strictEqual(store.setDecisionStatus('01-plain', 'Accepted'), true);
    assert.strictEqual(read(fs, '01-plain.md'), `---\nstatus: Accepted\n---\n${body}`);
  });

  test('given frontmatter with other keys, when the status is set, then every other key survives in order', () => {
    const { fs, store } = makeStore({
      'decisions/02-fm.md':
        '---\nstatus: Proposed\ndate: 2026-01-02\nowner: dana\ntags: [a, b]\n---\n# Decision 02 — FM\n\nBody.\n',
    });
    store.setDecisionStatus('02-fm', 'Superseded');
    assert.strictEqual(
      read(fs, '02-fm.md'),
      '---\nstatus: Superseded\ndate: 2026-01-02\nowner: dana\ntags: [a, b]\n---\n# Decision 02 — FM\n\nBody.\n',
    );
  });

  test('given a status of whitespace, when set, then it is refused and not one byte changes', () => {
    const { fs, store } = makeStore({
      'decisions/01-x.md': '---\nstatus: Proposed\n---\n# X\n',
    });
    const before = fs.snapshot();
    assert.strictEqual(store.setDecisionStatus('01-x', '   '), false);
    assert.strictEqual(store.setDecisionStatus('01-x', ''), false);
    assert.deepStrictEqual(fs.snapshot(), before);
  });

  test('given an unknown id, when the status is set, then it returns false and writes nothing', () => {
    const { fs, store } = makeStore({ 'decisions/01-x.md': '# X\n' });
    const before = fs.snapshot();
    assert.strictEqual(store.setDecisionStatus('nope', 'Accepted'), false);
    assert.deepStrictEqual(fs.snapshot(), before);
  });

  test('given a padded status, when set, then the stored value is trimmed', () => {
    const { fs, store } = makeStore({ 'decisions/01-x.md': '# X\n' });
    store.setDecisionStatus('01-x', '  Accepted  ');
    assert.strictEqual(read(fs, '01-x.md'), '---\nstatus: Accepted\n---\n# X\n');
  });

  test('given a body that opens with a --- rule, when the status is set, then the leading prose is consumed as frontmatter (data-loss hazard)', () => {
    // A body starting with `---` is indistinguishable from frontmatter, so the
    // prose between the two rules is parsed as (unusable) frontmatter and never
    // written back. Pinned here because it silently loses user text — see
    // DECISIONS NEEDED.
    const { fs, store } = makeStore({
      'decisions/01-rule.md': '---\n\nA horizontal rule opened this file.\n\n---\n\n# Rule\n',
    });
    store.setDecisionStatus('01-rule', 'Accepted');
    assert.strictEqual(
      read(fs, '01-rule.md'),
      '---\nstatus: Accepted\n---\n\n# Rule\n',
      'the text between the two rules is treated as frontmatter and lost',
    );
  });

  test.skip('given block-style YAML frontmatter, when the status is set, then the other keys survive', () => {
    // DEFECT: parseFrontmatter only understands `key: value` lines, so a YAML
    // block sequence is parsed as an empty string and re-serialized as `key: ""`
    // — the list is destroyed by a status change.
    // See REAL BUGS FOUND #1 (frontmatter.ts parseFrontmatter).
    const { fs, store } = makeStore({
      'decisions/01-nested.md':
        '---\nstatus: Proposed\nauthors:\n  - dana\n  - sam\n---\n# Decision 01 — Nested\n\nBody.\n',
    });
    store.setDecisionStatus('01-nested', 'Accepted');
    const after = read(fs, '01-nested.md');
    assert.ok(after.includes('  - dana'), `the authors list must survive, got:\n${after}`);
  });
});

describe('parseDecisionText — adversarial', () => {
  test('given an empty status key, when parsed, then the status falls back to Proposed', () => {
    const record = parseDecisionText('03-weird.md', '---\nstatus:\n---\n# Three\n');
    assert.strictEqual(record.status, 'Proposed');
    assert.strictEqual(record.date, undefined);
    assert.strictEqual(record.title, 'Three');
  });

  test('given no heading, when parsed, then the title is the title-cased id without its number', () => {
    const record = parseDecisionText('07-use-postgres.md', 'no heading here\n');
    assert.strictEqual(record.title, 'Use Postgres');
    assert.strictEqual(record.num, '07');
    assert.strictEqual(record.frontmatter, undefined);
  });

  test('given a Decision NN — or ADR-NN prefix in the heading, when parsed, then the prefix is stripped', () => {
    assert.strictEqual(
      parseDecisionText('01-x.md', '# Decision 01 — Real Title\n').title,
      'Real Title',
    );
    assert.strictEqual(parseDecisionText('01-x.md', '# ADR-1 - Real Title\n').title, 'Real Title');
    assert.strictEqual(
      parseDecisionText('01-x.md', '# Decisive Action\n').title,
      'Decisive Action',
    );
  });

  test('given a file name with no number, when parsed, then num defaults to 0000', () => {
    assert.strictEqual(parseDecisionText('notes.md', '# Notes\n').num, '0000');
  });

  test('given a non-string date, when parsed, then the date is omitted rather than coerced', () => {
    const record = parseDecisionText('01-x.md', '---\nstatus: Accepted\ndate: 2026\n---\n# X\n');
    assert.strictEqual(record.date, undefined, 'a bare number is not a date string');
    assert.deepStrictEqual(record.frontmatter, { status: 'Accepted', date: 2026 });
  });
});

describe('store decision listing and creation — adversarial', () => {
  test('given mixed numbering, when listed, then records sort numerically then by file name', () => {
    const { store } = makeStore({
      'decisions/10-ten.md': '# Ten\n',
      'decisions/2-two.md': '# Two\n',
      'decisions/notes.md': '# Notes\n',
      'decisions/.hidden.md': '# Hidden\n',
      'decisions/readme.txt': 'ignored',
    });
    assert.deepStrictEqual(
      store.listDecisions().map((d) => d.id),
      ['notes', '2-two', '10-ten'],
    );
  });

  test('given existing decisions, when one is created, then it takes the next number and a slugged name', () => {
    const { fs, store } = makeStore({ 'decisions/09-nine.md': '# Nine\n' });
    assert.strictEqual(store.createDecision('Use PostgreSQL!'), '10-use-postgresql');
    const created = read(fs, '10-use-postgresql.md');
    assert.ok(created.startsWith('---\nstatus: Proposed\ndate: 2026-01-01\n---\n'));
    assert.ok(created.includes('# Decision 10 — Use PostgreSQL!\n'));
  });

  test('given a blank title, when a decision is created, then it falls back to Untitled decision', () => {
    const { store } = makeStore({});
    assert.strictEqual(store.createDecision('   '), '01-untitled-decision');
  });

  test('given an unreadable-ish directory, when listed, then nothing throws and the list is empty', () => {
    const { store } = makeStore({});
    assert.deepStrictEqual(store.listDecisions(), []);
    assert.strictEqual(store.getDecision('nope'), undefined);
  });
});
