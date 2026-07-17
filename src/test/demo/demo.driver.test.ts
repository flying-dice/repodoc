import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Screenshot driver — NOT part of the regular test suites. Only runs when the
 * `demo` config is enabled via REPODOC_DEMO=1 (see .vscode-test.mjs).
 *
 * For each screen it opens the view, drops a `<phase>.ready` marker file, and
 * waits for the orchestrating shell to capture the window and reply with
 * `<phase>.done`.
 */

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

suite('RepoDoc demo driver', () => {
  test('drive screens for capture', async function () {
    if (process.env.REPODOC_MUTATE === '1') {
      this.skip();
    }
    this.timeout(240000);
    const markers = process.env.REPODOC_DEMO_MARKERS;
    assert.ok(markers, 'REPODOC_DEMO_MARKERS must be set');

    const phase = async (name: string, settleMs: number): Promise<void> => {
      await delay(settleMs);
      fs.writeFileSync(path.join(markers, `${name}.ready`), '');
      const donePath = path.join(markers, `${name}.done`);
      const start = Date.now();
      while (!fs.existsSync(donePath)) {
        if (Date.now() - start > 90000) {
          throw new Error(`capture orchestrator never confirmed phase ${name}`);
        }
        await delay(200);
      }
    };

    // Native navigation visible: focus the RepoDoc view container, and close
    // the auxiliary bar (Chat) so the shot is all RepoDoc.
    await vscode.commands.executeCommand('workbench.view.extension.repodoc');
    await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
    await delay(1500);

    await vscode.commands.executeCommand('repodoc.openBoard', 'project-backlog');
    await phase('board', 2500);

    const opened = await vscode.commands.executeCommand<boolean>(
      'repodoc.openCard',
      'project-backlog',
      'refactor-payments',
    );
    assert.strictEqual(opened, true, 'board panel should be open');
    await phase('card', 1200);

    // Gates + comments journal on the review card.
    await vscode.commands.executeCommand(
      'repodoc.openCard',
      'project-backlog',
      'v2-search-endpoint',
    );
    await phase('journal', 1200);

    await vscode.commands.executeCommand(
      'repodoc.openDecision',
      '01-record-architecture-decisions',
    );
    await phase('decision', 2000);

    await vscode.commands.executeCommand(
      'repodoc.openDoc',
      'docs/01-getting-started/01-introduction.md',
    );
    await phase('docs', 2000);

    // Prove native theming: same board, light theme. Posting an unknown card
    // id closes the modal left open by the card phase (render() drops it).
    await vscode.commands.executeCommand('repodoc.openBoard', 'project-backlog');
    await vscode.commands.executeCommand('repodoc.openCard', 'project-backlog', '__close__');
    await vscode.workspace
      .getConfiguration()
      .update('workbench.colorTheme', 'Default Light Modern', vscode.ConfigurationTarget.Global);
    await phase('light', 2500);
  });
});
