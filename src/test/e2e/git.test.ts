import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { RepoDocApi } from '../../extension';

const EXTENSION_ID = 'flying-dice.repodoc';

/**
 * Drives the real extension against a real repository created inside the
 * fixture workspace. A nested repository takes precedence over the outer
 * RepoDoc checkout, so `git rev-parse --show-toplevel` resolves here and the
 * workspace becomes its own repo root.
 */

function workspaceRoot(): string {
  const folders = vscode.workspace.workspaceFolders;
  assert.ok(folders && folders.length > 0, 'a fixture workspace must be open');
  return folders[0].uri.fsPath;
}

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'ignore', 'ignore'] });
}

function write(root: string, rel: string, content: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
}

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Decoration for a workspace-relative path, as the trees would receive it. */
function decorationFor(
  provider: vscode.FileDecorationProvider,
  root: string,
  relPath: string,
): vscode.FileDecoration | undefined {
  const uri = vscode.Uri.file(path.join(root, ...relPath.split('/')));
  const result = provider.provideFileDecoration(uri, new vscode.CancellationTokenSource().token);
  return result as vscode.FileDecoration | undefined;
}

suite('RepoDoc e2e — git awareness', () => {
  let api: RepoDocApi;
  let root: string;

  suiteSetup(async () => {
    root = workspaceRoot();
    for (const entry of fs.readdirSync(root)) {
      fs.rmSync(path.join(root, entry), { recursive: true, force: true });
    }

    git(root, 'init', '--initial-branch=main');
    git(root, 'config', 'user.email', 'test@example.invalid');
    git(root, 'config', 'user.name', 'RepoDoc Test');
    git(root, 'config', 'commit.gpgsign', 'false');

    write(root, 'docs/01-handbook.md', '# Handbook\n\n- one\n- two\n');
    write(
      root,
      'decisions/01-first.md',
      '---\nstatus: Proposed\ndate: 2026-01-01\n---\n# ADR 01 — First\n\nBody.\n',
    );
    git(root, 'add', '-A');
    git(root, 'commit', '-m', 'initial');

    const ext = vscode.extensions.getExtension<RepoDocApi>(EXTENSION_ID);
    assert.ok(ext, `extension ${EXTENSION_ID} should be installed`);
    api = await ext.activate();
    // The adapter resolved "no repository" before this suite created one.
    api.git.invalidate();
  });

  teardown(async () => {
    // Leave every test a clean tree and the setting on.
    git(root, 'checkout', '--', '.');
    await vscode.workspace
      .getConfiguration('repodoc')
      .update('git.enabled', undefined, vscode.ConfigurationTarget.Workspace);
    api.git.invalidate();
  });

  test('a committed, unmodified workspace reports no changes', () => {
    assert.strictEqual(api.git.isRepo(), true);
    assert.deepStrictEqual(api.git.status(), []);
  });

  test('an edited doc is reported as modified, with its HEAD content intact', () => {
    write(root, 'docs/01-handbook.md', '# Handbook\n\n- one\n- two changed\n');
    api.git.invalidate();
    assert.deepStrictEqual(api.git.status(), [
      { path: 'docs/01-handbook.md', status: 'modified' },
    ]);
    assert.strictEqual(
      api.git.readAtHead('docs/01-handbook.md'),
      '# Handbook\n\n- one\n- two\n',
    );
  });

  test('a new doc is reported as added and has no HEAD content', () => {
    write(root, 'docs/02-new.md', '# New\n\nFresh.\n');
    api.git.invalidate();
    assert.deepStrictEqual(api.git.status(), [{ path: 'docs/02-new.md', status: 'added' }]);
    assert.strictEqual(api.git.readAtHead('docs/02-new.md'), undefined);
    fs.rmSync(path.join(root, 'docs/02-new.md'));
  });

  test('turning repodoc.git.enabled off reports the workspace as git-free', async () => {
    write(root, 'docs/01-handbook.md', '# Handbook\n\n- one\n- two changed\n');
    api.git.invalidate();
    assert.strictEqual(api.git.status().length, 1, 'premise: there is a change to hide');

    await vscode.workspace
      .getConfiguration('repodoc')
      .update('git.enabled', false, vscode.ConfigurationTarget.Workspace);

    assert.strictEqual(api.git.isRepo(), false);
    assert.deepStrictEqual(api.git.status(), []);
  });

  test('the configuration listener drops cached decorations', async () => {
    write(root, 'docs/01-handbook.md', '# Handbook\n\n- one\n- two changed\n');
    api.git.invalidate();
    api.decorations.refresh();
    assert.ok(
      decorationFor(api.decorations, root, 'docs/01-handbook.md'),
      'premise: the file is badged while git is on',
    );

    await vscode.workspace
      .getConfiguration('repodoc')
      .update('git.enabled', false, vscode.ConfigurationTarget.Workspace);
    // The listener in activate() runs refreshTrees(), which drops the cache.
    await delay(300);

    assert.strictEqual(
      decorationFor(api.decorations, root, 'docs/01-handbook.md'),
      undefined,
      'badges must clear as soon as the setting flips, not at the next file change',
    );
  });

  test('a directory is badged when something beneath it changed', () => {
    write(root, 'docs/01-handbook.md', '# Handbook\n\n- one\n- two changed\n');
    api.git.invalidate();
    api.decorations.refresh();

    const file = decorationFor(api.decorations, root, 'docs/01-handbook.md');
    const dir = decorationFor(api.decorations, root, 'docs');
    assert.strictEqual(file?.badge, 'M');
    assert.strictEqual(dir?.badge, 'M', 'porcelain lists files; containers need deriving');
  });

  test('an unchanged directory is not badged', () => {
    api.git.invalidate();
    api.decorations.refresh();
    assert.strictEqual(decorationFor(api.decorations, root, 'decisions'), undefined);
  });

  test('a deleted file is reported by the port but never badged', () => {
    fs.rmSync(path.join(root, 'docs/01-handbook.md'));
    api.git.invalidate();
    api.decorations.refresh();

    assert.deepStrictEqual(api.git.status(), [
      { path: 'docs/01-handbook.md', status: 'deleted' },
    ]);
    // Nothing in the tree points at a file that is gone, so there is no node to
    // paint: the provider must not invent one.
    assert.strictEqual(decorationFor(api.decorations, root, 'docs/01-handbook.md'), undefined);
    assert.strictEqual(decorationFor(api.decorations, root, 'docs'), undefined);
  });

  test('toggleDiff acts on the focused panel, not always the doc panel', async () => {
    write(root, 'docs/01-handbook.md', '# Handbook\n\n- one\n- two changed\n');
    write(
      root,
      'decisions/01-first.md',
      '---\nstatus: Proposed\ndate: 2026-01-01\n---\n# ADR 01 — First\n\nBody, reworded.\n',
    );
    api.git.invalidate();

    await vscode.commands.executeCommand('repodoc.openDoc', 'docs/01-handbook.md');
    await delay(200);
    // Opened second, so this is the active panel.
    await vscode.commands.executeCommand('repodoc.openDecision', '01-first');
    await delay(200);

    const toggled = await vscode.commands.executeCommand<boolean>('repodoc.toggleDiff');
    assert.strictEqual(toggled, true);

    const titles = vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .map((tab) => tab.label);
    assert.ok(
      titles.some((t) => t.includes('First') && t.includes('HEAD')),
      `the focused decision panel should be in diff mode, tabs were: ${titles.join(' | ')}`,
    );
    assert.ok(
      !titles.some((t) => t.includes('Handbook') && t.includes('HEAD')),
      'the unfocused doc panel must be left alone',
    );
  });

  test('toggleDiff is a no-op on a file that matches HEAD', async () => {
    await vscode.commands.executeCommand('repodoc.openDoc', 'docs/01-handbook.md');
    await delay(200);
    api.git.invalidate();
    assert.strictEqual(
      await vscode.commands.executeCommand<boolean>('repodoc.toggleDiff'),
      false,
    );
  });

  test('a frontmatter-only edit is badged but offers no diff', async () => {
    write(
      root,
      'decisions/01-first.md',
      '---\nstatus: Accepted\ndate: 2026-01-01\n---\n# ADR 01 — First\n\nBody.\n',
    );
    api.git.invalidate();
    api.decorations.refresh();

    assert.strictEqual(
      decorationFor(api.decorations, root, 'decisions/01-first.md')?.badge,
      'M',
      'the file did change',
    );

    await vscode.commands.executeCommand('repodoc.openDecision', '01-first');
    await delay(200);
    assert.strictEqual(
      await vscode.commands.executeCommand<boolean>('repodoc.toggleDiff'),
      false,
      'the rendered body is identical, so there is nothing to diff',
    );
  });
});
