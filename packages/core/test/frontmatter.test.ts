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

describe('frontmatter.parse — opaque entries', () => {
  test('a key with indented continuation lines is kept out of data and preserved verbatim', () => {
    const text = '---\nstatus: Proposed\nauthors:\n  - dana\n  - sam\n---\nbody\n';
    const parsed = parseFrontmatter(text);
    assert.deepStrictEqual(parsed.data, { status: 'Proposed' });
    assert.strictEqual(serializeFrontmatter(parsed.data, parsed.body, parsed.raw), text);
  });

  test('comments, blank lines and malformed lines survive a round-trip', () => {
    const text = '---\n# a comment\n\nnot a key line\nkey: value\n---\nbody\n';
    const parsed = parseFrontmatter(text);
    assert.deepStrictEqual(parsed.data, { key: 'value' });
    assert.strictEqual(serializeFrontmatter(parsed.data, parsed.body, parsed.raw), text);
  });

  test('a key with an empty value round-trips as an empty string', () => {
    const text = '---\nstatus:\n---\nbody\n';
    const parsed = parseFrontmatter(text);
    assert.deepStrictEqual(parsed.data, { status: '' });
    assert.strictEqual(serializeFrontmatter(parsed.data, parsed.body, parsed.raw), text);
  });

  test('a block sequence at column 0 belongs to the key above it', () => {
    // YAML allows an unindented `- item` list under a key. Reading those lines
    // as unrelated chunks left `labels: [x]` sitting above orphaned `- a` lines
    // the next parse could not make sense of.
    const text = '---\ncolumn: todo\nlabels:\n- a\n- b\npriority: high\n---\nbody\n';
    const parsed = parseFrontmatter(text);
    assert.deepStrictEqual(
      parsed.data,
      { column: 'todo', priority: 'high' },
      'the block is opaque: no `labels` value is invented for it',
    );
    assert.strictEqual(
      serializeFrontmatter(parsed.data, parsed.body, parsed.raw),
      text,
      'a write that does not touch labels keeps the block byte-for-byte',
    );
  });

  test('setting a key whose block sequence sits at column 0 replaces the whole block', () => {
    const parsed = parseFrontmatter('---\nlabels:\n- a\n- b\npriority: high\n---\nbody\n');
    parsed.data['labels'] = ['x'];
    assert.strictEqual(
      serializeFrontmatter(parsed.data, parsed.body, parsed.raw),
      '---\nlabels: [x]\npriority: high\n---\nbody\n',
      'no dash line may be left orphaned under the rewritten key',
    );
  });

  test('a `- ` line under a key that HAS a value is still an opaque chunk of its own', () => {
    // Only an empty value can own an unindented sequence; `status: Proposed`
    // followed by a dash line is two unrelated things, and both survive.
    const text = '---\nstatus: Proposed\n- stray\n---\nbody\n';
    const parsed = parseFrontmatter(text);
    assert.deepStrictEqual(parsed.data, { status: 'Proposed' });
    assert.strictEqual(serializeFrontmatter(parsed.data, parsed.body, parsed.raw), text);
  });

  test('an inline # comment ends the value and survives an untouched round-trip', () => {
    const text = '---\npriority: high # why\nlabels: [a, b] # and why not\n---\nbody\n';
    const parsed = parseFrontmatter(text);
    assert.strictEqual(parsed.data['priority'], 'high');
    assert.deepStrictEqual(parsed.data['labels'], ['a', 'b']);
    assert.strictEqual(
      serializeFrontmatter(parsed.data, parsed.body, parsed.raw),
      text,
      'an unchanged pair keeps its line, comment and all',
    );
  });

  test('a # that is quoted, bracketed or starts the value is part of the value', () => {
    const { data } = parseFrontmatter(
      ['---', 'a: "keep # this"', 'b: [x #y, z]', 'c: #fff', 'd: plain#hash', '---', ''].join('\n'),
    );
    assert.strictEqual(data['a'], 'keep # this');
    assert.deepStrictEqual(data['b'], ['x #y', 'z']);
    assert.strictEqual(data['c'], '#fff', 'a value that opens with # is not a comment');
    assert.strictEqual(data['d'], 'plain#hash', 'only a # after whitespace starts a comment');
  });

  test('a value carrying a # is quoted on write, so it reads back whole', () => {
    const out = serializeFrontmatter({ status: 'fixing bug #12' }, 'body\n');
    assert.strictEqual(out, '---\nstatus: "fixing bug #12"\n---\nbody\n');
    assert.strictEqual(parseFrontmatter(out).data['status'], 'fixing bug #12');
  });

  test('an untouched value keeps its exact line; a changed one is rewritten', () => {
    const parsed = parseFrontmatter('---\nowner: "dana"\nn:   7\n---\nbody\n');
    parsed.data['n'] = 8;
    assert.strictEqual(
      serializeFrontmatter(parsed.data, parsed.body, parsed.raw),
      '---\nowner: "dana"\nn: 8\n---\nbody\n',
    );
  });

  test('a removed key loses its line and a new key is appended before the fence', () => {
    const parsed = parseFrontmatter('---\na: 1\nb: 2\n---\nbody\n');
    delete parsed.data['a'];
    parsed.data['c'] = 3;
    assert.strictEqual(
      serializeFrontmatter(parsed.data, parsed.body, parsed.raw),
      '---\nb: 2\nc: 3\n---\nbody\n',
    );
  });

  test('setting a key that was a block replaces the block with one line', () => {
    const parsed = parseFrontmatter('---\nauthors:\n  - dana\n---\nbody\n');
    parsed.data['authors'] = ['dana', 'sam'];
    assert.strictEqual(
      serializeFrontmatter(parsed.data, parsed.body, parsed.raw),
      '---\nauthors: [dana, sam]\n---\nbody\n',
    );
  });

  test('a duplicated key is emitted once, at the first position, with the winning value', () => {
    const parsed = parseFrontmatter('---\ncolumn: todo\ncolumn: done\n---\nbody\n');
    assert.strictEqual(parsed.data['column'], 'done', 'the last line wins on read');
    assert.strictEqual(
      serializeFrontmatter(parsed.data, parsed.body, parsed.raw),
      '---\ncolumn: done\n---\nbody\n',
    );
  });

  test('a block that declares no key at all is body, not frontmatter', () => {
    // A leading horizontal rule: consuming it would drop the prose beneath.
    const text = '---\n\nA horizontal rule opened this file.\n\n---\n\n# Rule\n';
    const parsed = parseFrontmatter(text);
    assert.deepStrictEqual(parsed.data, {});
    assert.deepStrictEqual(parsed.raw, []);
    assert.strictEqual(parsed.body, text);
  });

  test('an empty block is still frontmatter', () => {
    const parsed = parseFrontmatter('---\n---\nbody\n');
    assert.deepStrictEqual(parsed.data, {});
    assert.strictEqual(parsed.body, 'body\n');
  });

  test('serializing without raw writes exactly the keys given, in order', () => {
    assert.strictEqual(
      serializeFrontmatter({ b: 1, a: 'x' }, 'body\n'),
      '---\nb: 1\na: x\n---\nbody\n',
    );
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
