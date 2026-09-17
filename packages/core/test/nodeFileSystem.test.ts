/**
 * The containment check, against a real filesystem with real symlinks.
 *
 * The bug these cover: `path.resolve` is lexical, so a link inside the
 * workspace pointing out of it produced a path whose string was inside the
 * root while the file was not — and the adapter read and wrote through it.
 */

import { afterAll, describe, test } from 'bun:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { NodeFileSystemAdapter } from '../src/adapters/nodeFileSystem';

const roots: string[] = [];

/** A workspace with `outside/` as a sibling, so a link can escape into it. */
function makeWorkspace(): { root: string; outside: string } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'repodoc-fs-'));
  roots.push(base);
  const root = path.join(base, 'workspace');
  const outside = path.join(base, 'outside');
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, 'secret.md'), '# Secret\n', 'utf8');
  fs.writeFileSync(path.join(root, 'docs', 'real.md'), '# Real\n', 'utf8');
  return { root, outside };
}

describe('NodeFileSystemAdapter — containment', () => {
  afterAll(() => {
    for (const dir of roots) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('given an ordinary path, when read, then it works', () => {
    const { root } = makeWorkspace();
    const adapter = new NodeFileSystemAdapter(root);
    assert.strictEqual(adapter.readFile('docs/real.md'), '# Real\n');
    assert.strictEqual(adapter.exists('docs/real.md'), true);
  });

  test('given an absolute path or a .. segment, when resolved, then it is refused', () => {
    const { root } = makeWorkspace();
    const adapter = new NodeFileSystemAdapter(root);
    assert.strictEqual(adapter.readFile('/etc/passwd'), undefined);
    assert.strictEqual(adapter.readFile('../outside/secret.md'), undefined);
    assert.strictEqual(adapter.exists('../outside'), false);
  });

  test('given a symlink out of the workspace, when read through, then it is refused', () => {
    const { root, outside } = makeWorkspace();
    fs.symlinkSync(outside, path.join(root, 'docs', 'escape'));
    const adapter = new NodeFileSystemAdapter(root);

    assert.strictEqual(
      adapter.readFile('docs/escape/secret.md'),
      undefined,
      'the link resolves outside the root, so it is not the workspace"s file to read',
    );
    assert.strictEqual(adapter.exists('docs/escape/secret.md'), false);
    assert.deepStrictEqual(adapter.listDir('docs/escape'), []);
  });

  test('given a symlink out of the workspace, when written through, then nothing lands there', () => {
    const { root, outside } = makeWorkspace();
    fs.symlinkSync(outside, path.join(root, 'docs', 'escape'));
    const adapter = new NodeFileSystemAdapter(root);

    assert.throws(() => {
      adapter.writeFile('docs/escape/planted.md', '# Planted\n');
    });
    assert.strictEqual(
      fs.existsSync(path.join(outside, 'planted.md')),
      false,
      'a file that does not exist yet is judged by the parent that does',
    );
  });

  test('given a symlinked file out of the workspace, when read, then it is refused', () => {
    const { root, outside } = makeWorkspace();
    fs.symlinkSync(path.join(outside, 'secret.md'), path.join(root, 'docs', 'leak.md'));
    const adapter = new NodeFileSystemAdapter(root);
    assert.strictEqual(adapter.readFile('docs/leak.md'), undefined);
  });

  test('given a symlink that stays inside, when read through, then it still works', () => {
    const { root } = makeWorkspace();
    fs.mkdirSync(path.join(root, 'elsewhere'));
    fs.writeFileSync(path.join(root, 'elsewhere', 'inside.md'), '# Inside\n', 'utf8');
    fs.symlinkSync(path.join(root, 'elsewhere'), path.join(root, 'docs', 'linked'));
    const adapter = new NodeFileSystemAdapter(root);
    assert.strictEqual(
      adapter.readFile('docs/linked/inside.md'),
      '# Inside\n',
      'a link is only a problem when it leaves the workspace',
    );
  });

  test('given a rename through an escaping link, when attempted, then it is refused', () => {
    const { root, outside } = makeWorkspace();
    fs.symlinkSync(outside, path.join(root, 'docs', 'escape'));
    const adapter = new NodeFileSystemAdapter(root);
    assert.throws(() => {
      adapter.rename('docs/real.md', 'docs/escape/stolen.md');
    });
    assert.strictEqual(fs.existsSync(path.join(root, 'docs', 'real.md')), true);
    assert.strictEqual(fs.existsSync(path.join(outside, 'stolen.md')), false);
  });

  test('given a root that is itself a symlink, when used, then its own files still resolve', () => {
    const { root } = makeWorkspace();
    const linkedRoot = `${root}-link`;
    roots.push(linkedRoot);
    fs.symlinkSync(root, linkedRoot);
    const adapter = new NodeFileSystemAdapter(linkedRoot);
    assert.strictEqual(
      adapter.readFile('docs/real.md'),
      '# Real\n',
      'the root is realpathed too, so both sides of the comparison agree',
    );
    adapter.writeFile('docs/new.md', '# New\n');
    assert.strictEqual(fs.readFileSync(path.join(root, 'docs', 'new.md'), 'utf8'), '# New\n');
  });
});
