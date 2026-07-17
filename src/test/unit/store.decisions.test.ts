import * as assert from 'assert';
import { makeStore } from './helpers';

const SEED = {
  'decisions/01-record.md':
    '---\nstatus: Accepted\ndate: 2020-01-01\n---\n' +
    '# Decision 0001 — Record architecture decisions\n\nBody.\n',
  'decisions/03-postgres.md':
    '---\nstatus: Proposed\n---\n# ADR-3 — Use PostgreSQL\n\nBody.\n',
  'decisions/02-loose.md': '# A title with no ADR prefix\n\nNo frontmatter here.\n',
};

suite('store.listDecisions', () => {
  test('parses num, strips ADR/Decision prefix from title, and sorts by number', () => {
    const { store } = makeStore(SEED);
    const decisions = store.listDecisions();
    assert.deepStrictEqual(
      decisions.map((d) => [d.num, d.title, d.status]),
      [
        ['01', 'Record architecture decisions', 'Accepted'],
        ['02', 'A title with no ADR prefix', 'Proposed'],
        ['03', 'Use PostgreSQL', 'Proposed'],
      ],
    );
  });

  test('status and date come from frontmatter; body excludes the frontmatter', () => {
    const { store } = makeStore(SEED);
    const rec = store.listDecisions().find((d) => d.num === '01')!;
    assert.strictEqual(rec.status, 'Accepted');
    assert.strictEqual(rec.date, '2020-01-01');
    assert.ok(rec.body.startsWith('# Decision 0001'));
    assert.ok(!rec.body.includes('status: Accepted'));
  });

  test('id is the filename without extension', () => {
    const { store } = makeStore(SEED);
    const rec = store.listDecisions().find((d) => d.num === '01')!;
    assert.strictEqual(rec.id, '01-record');
    assert.strictEqual(rec.file, '01-record.md');
  });

  test('status defaults to Proposed and date is undefined without frontmatter', () => {
    const { store } = makeStore(SEED);
    const rec = store.listDecisions().find((d) => d.num === '02')!;
    assert.strictEqual(rec.status, 'Proposed');
    assert.strictEqual(rec.date, undefined);
  });

  test('a legacy body **Status:** line is NOT parsed (frontmatter only)', () => {
    const { store } = makeStore({
      'decisions/01-legacy.md': '# ADR-1 — Legacy\n\n**Status:** Accepted\n\nBody.\n',
    });
    assert.strictEqual(store.listDecisions()[0].status, 'Proposed');
  });

  test('ignores non-.md and dot files', () => {
    const { store } = makeStore({
      'decisions/01-a.md': '---\nstatus: Accepted\n---\n# ADR-1 — A\n',
      'decisions/notes.txt': 'ignore me',
      'decisions/.draft.md': '# Draft\n',
    });
    assert.strictEqual(store.listDecisions().length, 1);
  });
});

suite('store.getDecision', () => {
  test('returns the record matching an id', () => {
    const { store } = makeStore(SEED);
    assert.strictEqual(store.getDecision('03-postgres')!.title, 'Use PostgreSQL');
  });

  test('unknown id returns undefined', () => {
    const { store } = makeStore(SEED);
    assert.strictEqual(store.getDecision('nope'), undefined);
  });
});

suite('store.createDecision', () => {
  test('numbers sequentially after existing records with 2-pad and a title slug', () => {
    const { fs, store } = makeStore(SEED);
    const id = store.createDecision('Adopt event sourcing');
    assert.strictEqual(id, '04-adopt-event-sourcing');
    const content = fs.readFile('decisions/04-adopt-event-sourcing.md')!;
    assert.ok(content.startsWith('---\n'), 'skeleton starts with frontmatter');
    assert.ok(content.includes('status: Proposed'));
    assert.ok(content.includes('date: 2026-01-01'));
    assert.ok(content.includes('# Decision 04 — Adopt event sourcing'));
    assert.ok(content.includes('## Context'));
    assert.ok(content.includes('## Decision'));
    assert.ok(content.includes('## Consequences'));

    const rec = store.getDecision(id)!;
    assert.strictEqual(rec.status, 'Proposed');
    assert.strictEqual(rec.date, '2026-01-01');
  });

  test('starts at 01 in an empty repo', () => {
    const { store } = makeStore();
    assert.strictEqual(store.createDecision('First one'), '01-first-one');
  });

  test('blank title falls back to "Untitled decision"', () => {
    const { fs, store } = makeStore();
    const id = store.createDecision('   ');
    assert.strictEqual(id, '01-untitled-decision');
    assert.ok(fs.readFile(`decisions/${id}.md`)!.includes('Untitled decision'));
  });
});
