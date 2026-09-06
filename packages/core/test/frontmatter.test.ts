import { describe, test } from 'bun:test';
import * as assert from 'node:assert';
import { parseFrontmatter, serializeFrontmatter } from '../src/frontmatter';

describe('frontmatter.parse', () => {
  test('text with no frontmatter yields empty data and the whole body', () => {
    const text = '# Just a heading\n\nSome body text.\n';
    const { data, body } = parseFrontmatter(text);
    assert.deepStrictEqual(data, {});
    assert.strictEqual(body, text);
  });

  test('opening --- without a closing --- is treated as no frontmatter', () => {
    const text = '---\ncolumn: todo\n# never closed\n';
    const { data, body } = parseFrontmatter(text);
    assert.deepStrictEqual(data, {});
    assert.strictEqual(body, text);
  });

  test('empty frontmatter block yields empty data', () => {
    const { data, body } = parseFrontmatter('---\n---\nbody\n');
    assert.deepStrictEqual(data, {});
    assert.strictEqual(body, 'body\n');
  });

  test('unquoted / single- / double-quoted strings', () => {
    const { data } = parseFrontmatter(
      ['---', 'a: plain', "b: 'single'", 'c: "double"', '---', ''].join('\n'),
    );
    assert.strictEqual(data['a'], 'plain');
    assert.strictEqual(data['b'], 'single');
    assert.strictEqual(data['c'], 'double');
  });

  test('quoted values may contain a colon', () => {
    const { data } = parseFrontmatter(
      ['---', 'status: "editing src/x.ts: line 2"', '---', ''].join('\n'),
    );
    assert.strictEqual(data['status'], 'editing src/x.ts: line 2');
  });

  test('unquoted value keeps everything after the first colon', () => {
    const { data } = parseFrontmatter(['---', 'status: a: b: c', '---', ''].join('\n'));
    assert.strictEqual(data['status'], 'a: b: c');
  });

  test('numbers parse to numbers (int, negative, float)', () => {
    const { data } = parseFrontmatter(
      ['---', 'progress: 62', 'delta: -5', 'ratio: 1.5', '---', ''].join('\n'),
    );
    assert.strictEqual(data['progress'], 62);
    assert.strictEqual(data['delta'], -5);
    assert.strictEqual(data['ratio'], 1.5);
  });

  test('booleans parse to booleans', () => {
    const { data } = parseFrontmatter(['---', 'live: true', 'done: false', '---', ''].join('\n'));
    assert.strictEqual(data['live'], true);
    assert.strictEqual(data['done'], false);
  });

  test('inline arrays parse, including the empty array', () => {
    const { data } = parseFrontmatter(
      ['---', 'labels: [backend, infra]', 'files: []', '---', ''].join('\n'),
    );
    assert.deepStrictEqual(data['labels'], ['backend', 'infra']);
    assert.deepStrictEqual(data['files'], []);
  });

  test('inline array elements are unquoted', () => {
    const { data } = parseFrontmatter(['---', 'labels: ["a", \'b\']', '---', ''].join('\n'));
    assert.deepStrictEqual(data['labels'], ['a', 'b']);
  });

  test('malformed lines (no colon, empty key) are skipped', () => {
    const { data } = parseFrontmatter(
      ['---', 'this line has no colon', ': value-without-key', 'good: yes', '---', ''].join('\n'),
    );
    assert.deepStrictEqual(data, { good: 'yes' });
  });

  test('body is preserved verbatim, including --- lines inside the body', () => {
    const body = 'before\n\n---\n\nafter the divider\n';
    const text = ['---', 'column: todo', '---', body].join('\n');
    const parsed = parseFrontmatter(text);
    assert.strictEqual(parsed.data['column'], 'todo');
    assert.strictEqual(parsed.body, body);
  });

  test('CRLF newlines are normalized before parsing', () => {
    const text = '---\r\ncolumn: todo\r\n---\r\nbody line\r\n';
    const { data, body } = parseFrontmatter(text);
    assert.strictEqual(data['column'], 'todo');
    assert.strictEqual(body, 'body line\n');
  });
});

describe('frontmatter.serialize', () => {
  test('serialize -> parse round-trips a representative card payload', () => {
    const data: Record<string, unknown> = {
      column: 'doing',
      labels: ['backend', 'infra'],
      priority: 'high',
      agent: 'claude',
      live: true,
      status: 'editing src/core/store.ts',
      progress: 62,
      files: ['src/core/store.ts'],
      comments: 3,
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const body = '# Assign a card\n\nSome description.\n';
    const text = serializeFrontmatter(data, body);
    const parsed = parseFrontmatter(text);
    assert.deepStrictEqual(parsed.data, data);
    assert.strictEqual(parsed.body, body);
  });

  test('undefined values are omitted from the serialized output', () => {
    const text = serializeFrontmatter({ a: 'x', b: undefined, c: 1 }, 'body');
    assert.ok(!text.includes('b:'));
    const { data } = parseFrontmatter(text);
    assert.deepStrictEqual(data, { a: 'x', c: 1 });
  });

  test('number-like and boolean-like strings are quoted so they round-trip as strings', () => {
    const data = { a: '42', b: 'true' };
    const parsed = parseFrontmatter(serializeFrontmatter(data, 'body'));
    assert.strictEqual(parsed.data['a'], '42');
    assert.strictEqual(parsed.data['b'], 'true');
  });

  test('array items containing commas or brackets are quoted', () => {
    const data = { files: ['a,b', 'c]d'] };
    const parsed = parseFrontmatter(serializeFrontmatter(data, 'body'));
    assert.deepStrictEqual(parsed.data['files'], ['a,b', 'c]d']);
  });
});

describe('serializeFrontmatter — newline safety', () => {
  test('a newline inside a scalar or array item can never become a new key', () => {
    const out = serializeFrontmatter({ status: 'x\ncolumn: done', labels: ['a\r\nb'] }, '');
    assert.strictEqual(out, '---\nstatus: x column: done\nlabels: [a b]\n---\n');
    assert.strictEqual(parseFrontmatter(out).data['column'], undefined);
  });
});
