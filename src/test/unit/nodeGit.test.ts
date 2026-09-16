import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { NodeGitAdapter } from '../../adapters/nodeGit';
import { GitFileStatus } from '../../core/ports';

/**
 * These drive a real `git` binary against a throwaway repository — the only
 * way to pin down porcelain parsing. They touch the filesystem but never the
 * vscode API, so they stay in the unit suite.
 */

const repos: string[] = [];

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

/** A repository with one commit containing `files`, plus its path. */
function makeRepo(files: Record<string, string> = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repodoc-git-'));
  repos.push(dir);
  git(dir, 'init', '--initial-branch=main');
  git(dir, 'config', 'user.email', 'test@example.invalid');
  git(dir, 'config', 'user.name', 'RepoDoc Test');
  // Commits must not be signed or hooked by the developer's global config.
  git(dir, 'config', 'commit.gpgsign', 'false');
  write(dir, files);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', 'initial');
  return dir;
}

function write(dir: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  }
}

/** Status keyed by path, so assertions do not depend on git's ordering. */
function statusMap(adapter: NodeGitAdapter): Record<string, GitFileStatus> {
  const out: Record<string, GitFileStatus> = {};
  for (const entry of adapter.status()) {
    out[entry.path] = entry.status;
  }
  return out;
}

suite('adapters.NodeGitAdapter', () => {
  suiteTeardown(() => {
    for (const dir of repos) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a directory outside any repository is not a repo', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repodoc-nogit-'));
    repos.push(dir);
    // A stray parent repository would defeat the test; assert the premise.
    const adapter = new NodeGitAdapter(dir);
    if (adapter.isRepo()) {
      return; // tmpdir itself lives inside a repo on this machine — skip
    }
    assert.deepStrictEqual(adapter.status(), []);
    assert.strictEqual(adapter.readAtHead('docs/a.md'), undefined);
  });

  test('a repository with no commits yet is not usable as a baseline', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repodoc-unborn-'));
    repos.push(dir);
    git(dir, 'init', '--initial-branch=main');
    const adapter = new NodeGitAdapter(dir);
    assert.strictEqual(adapter.isRepo(), false);
    assert.strictEqual(adapter.readAtHead('anything.md'), undefined);
  });

  test('reads a committed file back at HEAD', () => {
    const dir = makeRepo({ 'docs/a.md': '# A\n' });
    const adapter = new NodeGitAdapter(dir);
    assert.strictEqual(adapter.isRepo(), true);
    assert.strictEqual(adapter.readAtHead('docs/a.md'), '# A\n');
  });

  test('a working-tree edit does not change what HEAD reports', () => {
    const dir = makeRepo({ 'docs/a.md': '# A\n' });
    const adapter = new NodeGitAdapter(dir);
    write(dir, { 'docs/a.md': '# A changed\n' });
    assert.strictEqual(adapter.readAtHead('docs/a.md'), '# A\n');
  });

  test('a path absent from HEAD reads as undefined', () => {
    const dir = makeRepo({ 'docs/a.md': '# A\n' });
    const adapter = new NodeGitAdapter(dir);
    assert.strictEqual(adapter.readAtHead('docs/new.md'), undefined);
  });

  test('a path escaping the workspace is refused', () => {
    const dir = makeRepo({ 'docs/a.md': '# A\n' });
    const adapter = new NodeGitAdapter(dir);
    assert.strictEqual(adapter.readAtHead('../outside.md'), undefined);
    assert.strictEqual(adapter.readAtHead('/etc/passwd'), undefined);
  });

  test('classifies modified, untracked and deleted files', () => {
    const dir = makeRepo({ 'docs/a.md': '# A\n', 'docs/b.md': '# B\n', 'docs/c.md': '# C\n' });
    write(dir, { 'docs/a.md': '# A changed\n', 'docs/new.md': '# New\n' });
    fs.rmSync(path.join(dir, 'docs/b.md'));
    const adapter = new NodeGitAdapter(dir);
    assert.deepStrictEqual(statusMap(adapter), {
      'docs/a.md': 'modified',
      'docs/b.md': 'deleted',
      'docs/new.md': 'added',
    });
  });

  test('a staged new file reads as added', () => {
    const dir = makeRepo({ 'docs/a.md': '# A\n' });
    write(dir, { 'docs/new.md': '# New\n' });
    git(dir, 'add', 'docs/new.md');
    assert.deepStrictEqual(statusMap(new NodeGitAdapter(dir)), { 'docs/new.md': 'added' });
  });

  test('a staged rename reads as renamed, at its new path', () => {
    const dir = makeRepo({ 'docs/a.md': '# A\nsome body text to make the rename obvious\n' });
    git(dir, 'mv', 'docs/a.md', 'docs/b.md');
    const entries = new NodeGitAdapter(dir).status();
    // The old path is consumed from the porcelain stream, not reported: only
    // the file that is there now can be badged in a tree.
    assert.deepStrictEqual(entries, [{ path: 'docs/b.md', status: 'renamed' }]);
  });

  test('a file added and deleted again is not reported', () => {
    const dir = makeRepo({ 'docs/a.md': '# A\n' });
    write(dir, { 'docs/tmp.md': '# Tmp\n' });
    git(dir, 'add', 'docs/tmp.md');
    fs.rmSync(path.join(dir, 'docs/tmp.md'));
    assert.deepStrictEqual(new NodeGitAdapter(dir).status(), []);
  });

  test('ignored files are not reported', () => {
    const dir = makeRepo({ 'docs/a.md': '# A\n', '.gitignore': 'ignored/\n' });
    write(dir, { 'ignored/x.md': '# X\n' });
    assert.deepStrictEqual(new NodeGitAdapter(dir).status(), []);
  });

  test('paths with spaces survive the porcelain parse', () => {
    const dir = makeRepo({ 'docs/a b.md': '# A\n' });
    write(dir, { 'docs/a b.md': '# A changed\n' });
    assert.deepStrictEqual(statusMap(new NodeGitAdapter(dir)), { 'docs/a b.md': 'modified' });
  });

  test('a workspace below the repository root reports paths relative to itself', () => {
    const dir = makeRepo({ 'sub/docs/a.md': '# A\n', 'other/z.md': '# Z\n' });
    write(dir, { 'sub/docs/a.md': '# A changed\n', 'other/z.md': '# Z changed\n' });
    const adapter = new NodeGitAdapter(path.join(dir, 'sub'));
    assert.strictEqual(adapter.readAtHead('docs/a.md'), '# A\n');
    // The change outside the workspace folder is not this workspace's business.
    assert.deepStrictEqual(statusMap(adapter), { 'docs/a.md': 'modified' });
  });

  test('status is cached until invalidated', () => {
    const dir = makeRepo({ 'docs/a.md': '# A\n' });
    const adapter = new NodeGitAdapter(dir);
    assert.deepStrictEqual(adapter.status(), []);
    write(dir, { 'docs/a.md': '# A changed\n' });
    assert.deepStrictEqual(adapter.status(), [], 'still the cached answer');
    adapter.invalidate();
    assert.deepStrictEqual(statusMap(adapter), { 'docs/a.md': 'modified' });
  });

  test('invalidate also drops cached HEAD content', () => {
    const dir = makeRepo({ 'docs/a.md': '# A\n' });
    const adapter = new NodeGitAdapter(dir);
    assert.strictEqual(adapter.readAtHead('docs/a.md'), '# A\n');
    write(dir, { 'docs/a.md': '# A committed\n' });
    git(dir, 'commit', '-am', 'second');
    adapter.invalidate();
    assert.strictEqual(adapter.readAtHead('docs/a.md'), '# A committed\n');
  });
});
