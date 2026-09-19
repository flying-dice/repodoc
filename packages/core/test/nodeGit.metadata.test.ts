/**
 * The adapter must say where git's metadata actually lives.
 *
 * The extension watched a workspace-relative `.git/{HEAD,index}`, which is
 * wrong in three ordinary situations:
 *
 *  - the workspace is a subfolder, so there is no `.git` beside it at all;
 *  - the workspace is a linked worktree, where `.git` is a *file* pointing
 *    elsewhere and the shared refs live in the common directory;
 *  - a soft reset moves the branch ref without touching `HEAD` or the index,
 *    so nothing under those two names changes even though the baseline did.
 *
 * In each case the cached status and baseline went stale with no event to
 * invalidate them.
 */

import { afterAll, describe, test } from 'bun:test';
import * as assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { NodeGitAdapter } from '../src/adapters/nodeGit';

const dirs: string[] = [];

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

function makeRepo(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repodoc-meta-'));
  dirs.push(dir);
  git(dir, 'init', '--initial-branch=main');
  git(dir, 'config', 'user.email', 'test@example.invalid');
  git(dir, 'config', 'user.name', 'RepoDoc Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', 'initial');
  return dir;
}

/** Every watched path must exist and sit inside git's own metadata directory. */
function assertUsable(paths: string[], gitDir: string, label: string): void {
  assert.ok(paths.length > 0, `${label}: nothing to watch`);
  for (const p of paths) {
    assert.ok(path.isAbsolute(p), `${label}: ${p} is not absolute`);
    assert.ok(
      path.resolve(p).startsWith(path.resolve(gitDir)) ||
        path.resolve(gitDir).startsWith(path.resolve(path.dirname(p))),
      `${label}: ${p} is outside ${gitDir}`,
    );
  }
}

describe('NodeGitAdapter — where git keeps its metadata', () => {
  afterAll(() => {
    for (const dir of dirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('given a workspace at the repository root, then the metadata dir is found', () => {
    const dir = makeRepo({ 'docs/a.md': '# A\n' });
    const adapter = new NodeGitAdapter(dir);
    const real = fs.realpathSync(path.join(dir, '.git'));
    assert.strictEqual(fs.realpathSync(adapter.metadataDir() ?? ''), real);
    assertUsable(adapter.metadataPaths(), real, 'root');
  });

  test('given a workspace BELOW the root, then the metadata dir is still found', () => {
    const dir = makeRepo({ 'sub/docs/a.md': '# A\n' });
    const adapter = new NodeGitAdapter(path.join(dir, 'sub'));
    const real = fs.realpathSync(path.join(dir, '.git'));
    assert.strictEqual(
      fs.realpathSync(adapter.metadataDir() ?? ''),
      real,
      'a subfolder workspace has no .git beside it; the old code watched a path that never existed',
    );
    assertUsable(adapter.metadataPaths(), real, 'subfolder');
  });

  test('given a linked worktree, then the COMMON metadata dir is found', () => {
    const dir = makeRepo({ 'docs/a.md': '# A\n' });
    const linked = path.join(dir, '..', `${path.basename(dir)}-wt`);
    dirs.push(linked);
    git(dir, 'worktree', 'add', linked, '-b', 'side');

    // In a linked worktree `.git` is a file, not a directory.
    assert.ok(fs.statSync(path.join(linked, '.git')).isFile(), 'premise: .git is a pointer file');

    const adapter = new NodeGitAdapter(linked);
    const common = fs.realpathSync(path.join(dir, '.git'));
    const watched = adapter.metadataPaths().map((p) => fs.realpathSync(path.dirname(p)));
    assert.ok(
      watched.some((p) => p.startsWith(common)),
      'refs are shared through the common dir; watching only the private dir misses a branch move',
    );
  });

  test('given a soft reset, then the watched set covers what changed', () => {
    const dir = makeRepo({ 'docs/a.md': '# A\n' });
    fs.writeFileSync(path.join(dir, 'docs/a.md'), '# A2\n', 'utf8');
    git(dir, 'commit', '-am', 'second');

    const adapter = new NodeGitAdapter(dir);
    const before = adapter.headSha();
    const watched = adapter.metadataPaths();

    git(dir, 'reset', '--soft', 'HEAD~1');
    adapter.invalidate();

    assert.notStrictEqual(adapter.headSha(), before, 'premise: the soft reset moved HEAD');
    assert.ok(
      watched.some((p) => /refs|packed-refs|HEAD/.test(p)),
      'a soft reset moves the branch ref, so refs must be watched, not just HEAD and index',
    );
  });

  test('given no repository, then there is nothing to watch', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repodoc-nogit-meta-'));
    dirs.push(dir);
    const adapter = new NodeGitAdapter(dir);
    if (adapter.isRepo()) {
      return; // tmpdir lives inside a repo on this machine
    }
    assert.strictEqual(adapter.metadataDir(), undefined);
    assert.deepStrictEqual(adapter.metadataPaths(), []);
  });
});
