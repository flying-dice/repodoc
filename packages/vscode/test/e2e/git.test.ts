import * as assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { RepoDocApi } from '../../src/extension';

const EXTENSION_ID = 'flying-dice.repodoc';

/**
 * Drives the real extension against a real repository created inside the
 * fixture workspace. A nested repository takes precedence over the outer
 * RepoDoc checkout, so `git rev-parse --show-toplevel` resolves here and the
 * workspace becomes its own repo root.
 */

function workspaceRoot(): string {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, 'a fixture workspace must be open');
  return folder.uri.fsPath;
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

/** Polls until `fn` holds, so assertions do not race the editor's own updates. */
async function waitFor(fn: () => boolean, timeoutMs = 5000): Promise<boolean> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeoutMs) {
      return false;
    }
    await delay(100);
  }
  return true;
}

/** Labels of every open tab, for asserting which panel is in diff mode. */
function tabLabels(): string[] {
  return vscode.window.tabGroups.all.flatMap((group) => group.tabs).map((tab) => tab.label);
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

    // Updating a workspace-scoped setting writes .vscode/settings.json into
    // this folder; ignore it or it turns up as an untracked change in every
    // status assertion below.
    write(root, '.gitignore', '.vscode/\n');
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
    // Leave every test a clean tree and the setting on. `clean -fd` drops files
    // a test added; ignored paths (.vscode/) are left alone.
    git(root, 'checkout', '--', '.');
    git(root, 'clean', '-fd');
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
    assert.deepStrictEqual(api.git.status(), [{ path: 'docs/01-handbook.md', status: 'modified' }]);
    assert.strictEqual(api.git.readAtHead('docs/01-handbook.md'), '# Handbook\n\n- one\n- two\n');
  });

  test('a new doc is reported as added and has no HEAD content', () => {
    write(root, 'docs/02-new.md', '# New\n\nFresh.\n');
    api.git.invalidate();
    assert.deepStrictEqual(api.git.status(), [{ path: 'docs/02-new.md', status: 'added' }]);
    assert.strictEqual(api.git.readAtHead('docs/02-new.md'), undefined);
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

    assert.deepStrictEqual(api.git.status(), [{ path: 'docs/01-handbook.md', status: 'deleted' }]);
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

    // The tab label follows panel.title asynchronously.
    const flipped = await waitFor(() =>
      tabLabels().some((t) => t.includes('First') && t.includes('HEAD')),
    );
    assert.ok(
      flipped,
      `the focused decision panel should be in diff mode, tabs were: ${tabLabels().join(' | ')}`,
    );
    assert.ok(
      !tabLabels().some((t) => t.includes('Handbook') && t.includes('HEAD')),
      'the unfocused doc panel must be left alone',
    );
  });

  test('toggleDiff is a no-op on a file that matches HEAD', async () => {
    await vscode.commands.executeCommand('repodoc.openDoc', 'docs/01-handbook.md');
    await delay(200);
    api.git.invalidate();
    assert.strictEqual(await vscode.commands.executeCommand<boolean>('repodoc.toggleDiff'), false);
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

/**
 * These deliberately never call `api.git.invalidate()`.
 *
 * Every other test in this file does, which makes them tests of the adapter
 * rather than of the extension: they would all pass with no file watcher at
 * all. #24 asked for the opposite — drive a real git event and wait for the
 * extension to notice by itself.
 */
suite('RepoDoc e2e — git events reach the extension', () => {
  let api: RepoDocApi;
  let root: string;

  /** Polls until `fn` holds; the watcher is debounced, so this is not instant. */
  async function eventually(fn: () => boolean, timeoutMs = 15000): Promise<boolean> {
    const start = Date.now();
    while (!fn()) {
      if (Date.now() - start > timeoutMs) {
        return false;
      }
      await delay(200);
    }
    return true;
  }

  suiteSetup(async () => {
    root = workspaceRoot();
    const ext = vscode.extensions.getExtension<RepoDocApi>(EXTENSION_ID);
    assert.ok(ext);
    api = await ext.activate();
    api.git.invalidate(); // once, to pick up the repository this suite created
  });

  test('given an edit on disk, when nothing calls invalidate, then the extension notices', async () => {
    write(root, 'docs/01-handbook.md', '# Handbook\n\n- one\n- two watched\n');

    const noticed = await eventually(() =>
      api.git.status().some((e) => e.path === 'docs/01-handbook.md'),
    );
    assert.ok(noticed, 'the content watcher must invalidate the cache without being asked');

    git(root, 'checkout', '--', '.');
    await eventually(() => api.git.status().length === 0);
  });

  test('given a commit outside the editor, when nothing calls invalidate, then the baseline moves', async () => {
    const before = api.git.headSha();
    write(root, 'docs/01-handbook.md', '# Handbook\n\n- one\n- committed elsewhere\n');
    git(root, 'commit', '-am', 'committed outside the editor');

    const moved = await eventually(() => api.git.headSha() !== before);
    assert.ok(moved, 'a commit moves HEAD and the refs; the metadata watcher must see it');
    assert.strictEqual(
      api.git.readAtHead('docs/01-handbook.md'),
      '# Handbook\n\n- one\n- committed elsewhere\n',
      'the baseline is the new commit, not the one cached before it',
    );
  });

  test('given a soft reset, when nothing calls invalidate, then the baseline moves back', async () => {
    const before = api.git.headSha();
    // A soft reset rewrites the branch ref and leaves HEAD and the index alone,
    // which is exactly what the old `.git/{HEAD,index}` watcher could not see.
    git(root, 'reset', '--soft', 'HEAD~1');

    const moved = await eventually(() => api.git.headSha() !== before);
    assert.ok(moved, 'the refs are watched, so a branch move is an event');
  });

  test('the metadata paths the extension watches all exist', () => {
    const paths = api.git.metadataPaths();
    assert.ok(paths.length > 0, 'a repository must offer something to watch');
    for (const p of paths) {
      assert.ok(path.isAbsolute(p), `${p} is not absolute`);
    }
    assert.ok(
      paths.some((p) => p.endsWith('refs')),
      'refs must be among them or a soft reset goes unnoticed',
    );
  });
});
