import * as vscode from 'vscode';
import { RepoDocStore } from './store';
import { BoardsTreeProvider, DecisionsTreeProvider, DocsTreeProvider } from './trees';
import { BoardPanel } from './panels/boardPanel';
import { MarkdownPanel } from './panels/markdownPanel';

export function activate(context: vscode.ExtensionContext): void {
  const store = new RepoDocStore(context);
  context.subscriptions.push(store);

  const boardsTree = new BoardsTreeProvider(store);
  const decisionsTree = new DecisionsTreeProvider(store);
  const docsTree = new DocsTreeProvider(store);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('repodoc.boards', boardsTree),
    vscode.window.registerTreeDataProvider('repodoc.decisions', decisionsTree),
    vscode.window.registerTreeDataProvider('repodoc.docs', docsTree),
  );

  const updateInitializedContext = (): void => {
    void vscode.commands.executeCommand('setContext', 'repodoc.initialized', store.isInitialized());
  };
  updateInitializedContext();

  const refreshTrees = (): void => {
    boardsTree.refresh();
    decisionsTree.refresh();
    docsTree.refresh();
  };

  context.subscriptions.push(
    store.onDidChange(() => {
      updateInitializedContext();
      refreshTrees();
      BoardPanel.refreshAll();
      MarkdownPanel.refreshAll();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('repodoc.init', async () => {
      await store.init();
      updateInitializedContext();
      refreshTrees();
      void vscode.window.showInformationMessage('RepoDoc initialized in this workspace.');
    }),

    vscode.commands.registerCommand('repodoc.refresh', () => {
      refreshTrees();
    }),

    vscode.commands.registerCommand('repodoc.openBoard', (boardId: string) => {
      BoardPanel.createOrShow(context.extensionUri, store, boardId);
    }),

    vscode.commands.registerCommand('repodoc.openDecision', (id: string) => {
      MarkdownPanel.showDecision(context.extensionUri, store, id);
    }),

    vscode.commands.registerCommand('repodoc.openDoc', (relPath: unknown) => {
      if (typeof relPath === 'string' && relPath.length > 0) {
        MarkdownPanel.showDoc(context.extensionUri, store, relPath);
      }
    }),

    vscode.commands.registerCommand('repodoc.newBoard', async () => {
      const name = await vscode.window.showInputBox({
        prompt: 'Board name',
        placeHolder: 'e.g. Sprint 24',
      });
      if (!name || !name.trim()) {
        return;
      }
      const id = store.createBoard(name.trim());
      BoardPanel.createOrShow(context.extensionUri, store, id);
    }),

    vscode.commands.registerCommand('repodoc.newDecision', async () => {
      const title = await vscode.window.showInputBox({
        prompt: 'Decision title',
        placeHolder: 'e.g. Use PostgreSQL as the primary datastore',
      });
      if (!title || !title.trim()) {
        return;
      }
      const id = store.createDecision(title.trim());
      if (id) {
        MarkdownPanel.showDecision(context.extensionUri, store, id);
      }
    }),
  );
}

export function deactivate(): void {}
