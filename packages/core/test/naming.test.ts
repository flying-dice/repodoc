import { describe, test } from 'bun:test';
import * as assert from 'node:assert';
import {
  markdownTitle,
  numPrefix,
  pad,
  slugFromFileName,
  slugify,
  stripNumPrefix,
  titleCase,
} from '../src/naming';

describe('naming.slugify', () => {
  test('lowercases and hyphenates spaces', () => {
    assert.strictEqual(slugify('Hello World'), 'hello-world');
  });

  test('collapses runs of symbols and trims leading/trailing hyphens', () => {
    assert.strictEqual(slugify('  Use PostgreSQL!! (primary) '), 'use-postgresql-primary');
  });

  test('mixed case and punctuation', () => {
    assert.strictEqual(slugify('Fix: the/Bug #42'), 'fix-the-bug-42');
  });

  test('emoji-only falls back to the default', () => {
    assert.strictEqual(slugify('🚀🔥'), 'untitled');
  });

  test('emoji-only respects a custom fallback', () => {
    assert.strictEqual(slugify('🚀', 'card'), 'card');
  });

  test('already-slug input is unchanged', () => {
    assert.strictEqual(slugify('already-a-slug'), 'already-a-slug');
  });
});

describe('naming.stripNumPrefix', () => {
  test('strips a leading NN- prefix', () => {
    assert.strictEqual(stripNumPrefix('03-intro'), 'intro');
  });

  test('leaves un-prefixed names alone', () => {
    assert.strictEqual(stripNumPrefix('intro'), 'intro');
  });

  test('only strips the first numeric prefix', () => {
    assert.strictEqual(stripNumPrefix('01-02-thing'), '02-thing');
  });
});

describe('naming.numPrefix', () => {
  test('returns the numeric prefix as a number', () => {
    assert.strictEqual(numPrefix('07-slug.md'), 7);
  });

  test('returns undefined without a prefix', () => {
    assert.strictEqual(numPrefix('slug.md'), undefined);
  });

  test('needs the trailing hyphen to count as a prefix', () => {
    assert.strictEqual(numPrefix('12abc'), undefined);
  });
});

describe('naming.pad', () => {
  test('pads to the requested width', () => {
    assert.strictEqual(pad(3, 2), '03');
  });

  test('does not truncate numbers wider than the pad width', () => {
    assert.strictEqual(pad(123, 2), '123');
  });

  test('width of 3 pads single digits', () => {
    assert.strictEqual(pad(4, 3), '004');
  });
});

describe('naming.titleCase', () => {
  test('turns a slug into Title Case', () => {
    assert.strictEqual(titleCase('project-backlog'), 'Project Backlog');
  });

  test('collapses whitespace and capitalizes each word', () => {
    assert.strictEqual(titleCase('  getting   started '), 'Getting Started');
  });

  test('empty string stays empty', () => {
    assert.strictEqual(titleCase(''), '');
  });
});

describe('naming.slugFromFileName', () => {
  test('drops the .md extension and NN- prefix', () => {
    assert.strictEqual(slugFromFileName('03-my-card.md'), 'my-card');
  });

  test('is case-insensitive on the extension', () => {
    assert.strictEqual(slugFromFileName('01-intro.MD'), 'intro');
  });

  test('leaves an already-slug name alone', () => {
    assert.strictEqual(slugFromFileName('intro.md'), 'intro');
  });
});

describe('naming.markdownTitle', () => {
  test('uses the first ATX heading when present', () => {
    assert.strictEqual(markdownTitle('# Real Title\n\nBody\n', 'fallback'), 'Real Title');
  });

  test('trims surrounding whitespace on the heading', () => {
    assert.strictEqual(markdownTitle('#   Spaced   \n', 'fallback'), 'Spaced');
  });

  test('finds a heading that is not on the first line', () => {
    assert.strictEqual(markdownTitle('---\ncolumn: todo\n---\n# Later\n', 'fallback'), 'Later');
  });

  test('falls back to the title-cased name when there is no heading', () => {
    assert.strictEqual(markdownTitle('no heading here\n', 'my-doc'), 'My Doc');
  });

  test('empty content uses the fallback', () => {
    assert.strictEqual(markdownTitle('', 'read-me'), 'Read Me');
  });
});
