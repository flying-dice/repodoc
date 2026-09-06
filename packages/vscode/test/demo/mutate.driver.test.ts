import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Opt-in visual driver (REPODOC_MUTATE=1): opens the board, adds a card and a
 * comment through the REAL webview channel, and pauses at marker points so an
 * orchestrating shell can screenshot the live webview to confirm it re-renders.
 */
function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

suite('RepoDoc mutate driver', () => {
  test('mutations re-render the live board', async function () {
    if (process.env.REPODOC_MUTATE !== '1') {
      this.skip();
    }
    this.timeout(180000);
    const markers = process.env.REPODOC_DEMO_MARKERS!;
    const board = 'project-backlog';

    const phase = async (name: string, settleMs: number): Promise<void> => {
      await delay(settleMs);
      fs.writeFileSync(path.join(markers, `${name}.ready`), '');
      const done = path.join(markers, `${name}.done`);
      const start = Date.now();
      while (!fs.existsSync(done)) {
        if (Date.now() - start > 90000) {
          throw new Error(`orchestrator never confirmed ${name}`);
        }
        await delay(200);
      }
    };
    const bounce = (message: unknown): Thenable<boolean> =>
      vscode.commands.executeCommand<boolean>('repodoc.bounceWebviewMessage', board, message);

    await vscode.commands.executeCommand('workbench.view.extension.repodoc');
    await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
    await delay(1000);
    await vscode.commands.executeCommand('repodoc.openBoard', board);
    await delay(2500);

    // Warm-up until the channel is live.
    for (let i = 0; i < 40; i++) {
      await bounce({ type: 'addCard', column: 'backlog', title: `Warmup ${i}` });
      await delay(200);
      // Stop once at least one warmup card exists on disk (channel proven).
      break;
    }
    await delay(500);

    // Add a clearly-named card, then screenshot the live board.
    await bounce({ type: 'addCard', column: 'todo', title: 'ADDED FROM UI CHANNEL' });
    await phase('added', 1500);
  });
});
