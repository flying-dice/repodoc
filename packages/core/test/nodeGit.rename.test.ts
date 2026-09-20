/**
 * A staged rename must keep its `HEAD` path.
 *
 * Porcelain reports `R  <new><NUL><old><NUL>`. The adapter consumed the old
 * path and threw it away, so the baseline lookup asked for `HEAD:<new path>` —
 * which does not exist — and every reading view treated a renamed file as newly
 * added, comparing it against an empty baseline. A rename with no content edit
 * rendered as though the whole document had just been written.
 *
 * I removed this field in an earlier review as dead code. It was not dead; it
 * was unused, which is a different thing, and this is the cost.
 */

import { afterAll, describe, test } from 'bun:test';
import * as assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { NodeGitAdapter } from '../src/adapters/nodeGit';

const repos: string[] = [];

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'ignore', 'ignore'] });
}

function makeRepo(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repodoc-rename-'));
  repos.push(dir);
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

const BODY = '# A\nsome body text long enough for git to call it a rename\n';

describe('NodeGitAdapter — staged renames', () => {
  afterAll(() => {
    for (const dir of repos) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('given a staged rename, when status is read, then the old path is retained', () => {
    const dir = makeRepo({ 'docs/a.md': BODY });
    git(dir, 'mv', 'docs/a.md', 'docs/b.md');
    const entries = new NodeGitAdapter(dir).status();
    assert.deepStrictEqual(entries, [
      { path: 'docs/b.md', status: 'renamed', originalPath: 'docs/a.md' },
    ]);
  });

  test('given a staged rename, when the baseline is read, then it comes from the old path', () => {
    const dir = makeRepo({ 'docs/a.md': BODY });
    git(dir, 'mv', 'docs/a.md', 'docs/b.md');
    const adapter = new NodeGitAdapter(dir);

    assert.strictEqual(
      adapter.readAtHead('docs/b.md'),
      BODY,
      'a renamed file is not a new file; its baseline is what it was called before',
    );
    assert.strictEqual(
      adapter.baselinePathOf('docs/b.md'),
      'docs/a.md',
      'the mapping is exposed so callers can explain what they compared against',
    );
  });

  test('given a staged rename plus an edit, when the baseline is read, then the old content comes back', () => {
    const dir = makeRepo({ 'docs/a.md': BODY });
    git(dir, 'mv', 'docs/a.md', 'docs/b.md');
    fs.writeFileSync(path.join(dir, 'docs/b.md'), `${BODY}An added paragraph.\n`, 'utf8');
    const adapter = new NodeGitAdapter(dir);
    assert.strictEqual(adapter.readAtHead('docs/b.md'), BODY);
  });

  test('given a genuinely new file, when the baseline is read, then there is none', () => {
    const dir = makeRepo({ 'docs/a.md': BODY });
    fs.writeFileSync(path.join(dir, 'docs/new.md'), '# New\n', 'utf8');
    const adapter = new NodeGitAdapter(dir);
    assert.strictEqual(adapter.readAtHead('docs/new.md'), undefined);
    assert.strictEqual(adapter.baselinePathOf('docs/new.md'), 'docs/new.md');
  });

  test('given an ordinary edit, when the baseline is read, then the path is unchanged', () => {
    const dir = makeRepo({ 'docs/a.md': BODY });
    fs.writeFileSync(path.join(dir, 'docs/a.md'), `${BODY}more\n`, 'utf8');
    const adapter = new NodeGitAdapter(dir);
    assert.strictEqual(adapter.baselinePathOf('docs/a.md'), 'docs/a.md');
    assert.strictEqual(adapter.readAtHead('docs/a.md'), BODY);
  });
});
