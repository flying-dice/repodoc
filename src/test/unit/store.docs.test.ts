import * as assert from 'assert';
import { DocNode } from '../../core/types';
import { makeStore } from './helpers';

const SEED = {
  'docs/01-intro.md': '# Introduction\n\nWelcome.\n',
  'docs/02-guides/01-a.md': '# Guide A\n\nA guide.\n',
  'docs/readme.md': 'no heading in this file\n',
  'docs/appendix/01-x.md': '# X\n',
};

function names(nodes: DocNode[]): string[] {
  return nodes.map((n) => n.name);
}

suite('store.getDocsTree', () => {
  test('orders NN-prefixed entries by number, then the rest alphabetically', () => {
    const { store } = makeStore(SEED);
    // NOTE: ordering is purely numeric-prefix-then-alpha; directories are NOT
    // hoisted above files. See report note on "dirs first".
    assert.deepStrictEqual(names(store.getDocsTree()), [
      '01-intro.md',
      '02-guides',
      'appendix',
      'readme.md',
    ]);
  });

  test('file labels come from the first heading, dir labels from the stripped name', () => {
    const { store } = makeStore(SEED);
    const tree = store.getDocsTree();
    const byName = new Map(tree.map((n) => [n.name, n]));
    assert.strictEqual(byName.get('01-intro.md')!.label, 'Introduction'); // from heading
    assert.strictEqual(byName.get('readme.md')!.label, 'Readme'); // no heading -> filename
    assert.strictEqual(byName.get('02-guides')!.label, 'Guides'); // dir, prefix stripped
    assert.strictEqual(byName.get('appendix')!.label, 'Appendix');
  });

  test('nested directories are walked recursively', () => {
    const { store } = makeStore(SEED);
    const guides = store.getDocsTree().find((n) => n.name === '02-guides')!;
    assert.strictEqual(guides.type, 'dir');
    assert.deepStrictEqual(names(guides.children!), ['01-a.md']);
    assert.strictEqual(guides.children![0].label, 'Guide A');
    assert.strictEqual(guides.children![0].relPath, 'docs/02-guides/01-a.md');
  });

  test('empty when there is no docs/ directory', () => {
    const { store } = makeStore();
    assert.deepStrictEqual(store.getDocsTree(), []);
  });
});

suite('store.readDoc', () => {
  test('returns title (from heading) and full body', () => {
    const { store } = makeStore(SEED);
    const doc = store.readDoc('docs/01-intro.md')!;
    assert.strictEqual(doc.title, 'Introduction');
    assert.strictEqual(doc.body, '# Introduction\n\nWelcome.\n');
  });

  test('title falls back to the stripped filename when there is no heading', () => {
    const { store } = makeStore(SEED);
    assert.strictEqual(store.readDoc('docs/readme.md')!.title, 'Readme');
  });

  test('rejects parent-traversal and absolute paths', () => {
    const { store } = makeStore({ 'secret.md': '# secret\n' });
    assert.strictEqual(store.readDoc('../secret.md'), undefined);
    assert.strictEqual(store.readDoc('a/../../secret.md'), undefined);
    assert.strictEqual(store.readDoc('/etc/passwd'), undefined);
  });

  test('accepts a filename that merely contains dots', () => {
    const { store } = makeStore({ 'docs/foo..bar.md': '# Dotty\n' });
    assert.strictEqual(store.readDoc('docs/foo..bar.md')!.title, 'Dotty');
  });

  test('missing file returns undefined', () => {
    const { store } = makeStore(SEED);
    assert.strictEqual(store.readDoc('docs/nope.md'), undefined);
  });
});

suite('store.readDoc — frontmatter', () => {
  test('frontmatter is parsed out of the body and returned separately', () => {
    const { store } = makeStore({
      'docs/01-a.md': '---\nauthor: sam\ntags: [intro, setup]\ndraft: true\n---\n# A\n\nBody.\n',
    });
    const doc = store.readDoc('docs/01-a.md')!;
    assert.deepStrictEqual(doc.frontmatter, { author: 'sam', tags: ['intro', 'setup'], draft: true });
    assert.ok(doc.body.startsWith('# A'));
    assert.ok(!doc.body.includes('author:'));
  });

  test('docs without frontmatter have no frontmatter key', () => {
    const { store } = makeStore({ 'docs/01-a.md': '# A\n\nBody.\n' });
    assert.strictEqual(store.readDoc('docs/01-a.md')!.frontmatter, undefined);
  });
});
