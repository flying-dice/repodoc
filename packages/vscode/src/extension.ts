import * as path from 'node:path';
import {
  type AgentKind,
  MemFileSystemAdapter,
  NodeFileSystemAdapter,
  RepoDocStore,
  SKILL_TARGETS,
  SkillManager,
  SystemClock,
} from '@repodoc/core';
import * as vscode from 'vscode';
import { BoardPanel, copyRefToClipboard } from './panels/boardPanel';
import { CardBoardSource, FeatureSetSource } from './panels/boardSource';
import { MarkdownPanel } from './panels/markdownPanel';
import type { WebviewToHostMessage } from './panels/protocol';
import { BoardsTreeProvider, DecisionsTreeProvider, DocsTreeProvider } from './trees';

/** Public surface returned by {@link activate}, used by e2e tests. */
export interface RepoDocApi {
  store: RepoDocStore;
}

export function activate(context: vscode.ExtensionContext): RepoDocApi {
  const folders = vscode.workspace.workspaceFolders;
  const root = folders?.[0]?.uri.fsPath;
  const fileSystem = root ? new NodeFileSystemAdapter(root) : new MemFileSystemAdapter();
  const store = new RepoDocStore(fileSystem, new SystemClock(), root);
  const skillManager = new SkillManager(fileSystem);

  if (root) {
    // Installed agent skill files are managed, but never rewritten silently:
    // when the bundled content is newer, offer a sync instead.
    const stale = skillManager.outdated();
    if (stale.length > 0) {
      void vscode.window
        .showInformationMessage(
          `RepoDoc: ${stale.length} installed agent skill file(s) are out of date.`,
          'Update',
        )
        .then((choice) => {
          if (choice === 'Update') {
            const synced = skillManager.syncInstalled();
            void vscode.window.showInformationMessage(
              `RepoDoc: updated ${synced.length} agent skill file(s).`,
            );
          }
        });
    }
  }

  if (root) {
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const scheduleChange = (): void => {
      if (debounce) {
        clearTimeout(debounce);
      }
      debounce = setTimeout(() => {
        debounce = undefined;
        store.notifyExternalChange();
      }, 150);
    };
    for (const pattern of ['**/boards/**', '**/decisions/**', '**/docs/**', '**/features/**']) {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(root, pattern),
      );
      watcher.onDidChange(scheduleChange);
      watcher.onDidCreate(scheduleChange);
      watcher.onDidDelete(scheduleChange);
      context.subscriptions.push(watcher);
    }
    context.subscriptions.push({
      dispose: () => {
        if (debounce) {
          clearTimeout(debounce);
        }
      },
    });
  }

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
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('repodoc')) {
        MarkdownPanel.refreshAll();
        BoardPanel.refreshAll();
      }
    }),
    store.onDidChange(() => {
      updateInitializedContext();
      refreshTrees();
      BoardPanel.refreshAll();
      MarkdownPanel.refreshAll();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('repodoc.init', () => {
      if (!root) {
        void vscode.window.showWarningMessage(
          'RepoDoc: open a folder first — there is no workspace to initialize.',
        );
        return;
      }
      store.init();
      updateInitializedContext();
      refreshTrees();
      void vscode.window.showInformationMessage('RepoDoc initialized in this workspace.');
    }),

    vscode.commands.registerCommand('repodoc.refresh', () => {
      refreshTrees();
    }),

    vscode.commands.registerCommand('repodoc.openSettings', () => {
      void vscode.commands.executeCommand(
        'workbench.action.openSettings',
        '@ext:flying-dice.repodoc',
      );
    }),

    vscode.commands.registerCommand('repodoc.openBoard', (arg: unknown) => {
      // Invoked with a board id (tree item command / API) or with the tree
      // node itself (inline action / context menu) — which may be a board or a
      // feature set; both render in the same panel behind a BoardSource.
      if (typeof arg === 'string') {
        BoardPanel.createOrShow(context.extensionUri, store, new CardBoardSource(store, arg));
        return;
      }
      const node = arg as { kind?: string; ref?: { id?: string } } | undefined;
      const id = node?.ref?.id;
      if (!id) {
        return;
      }
      if (node?.kind === 'board') {
        BoardPanel.createOrShow(context.extensionUri, store, new CardBoardSource(store, id));
      } else if (node?.kind === 'featureSet') {
        BoardPanel.createOrShow(context.extensionUri, store, new FeatureSetSource(store, id));
      }
    }),

    // Internal (not contributed to the palette): open a feature's `.feature`
    // file in the editor. Used by feature items in the Boards tree.
    vscode.commands.registerCommand(
      'repodoc.openFeature',
      async (setId: unknown, featureId: unknown): Promise<void> => {
        if (typeof setId !== 'string' || typeof featureId !== 'string' || !root) {
          return;
        }
        const relPath = store.featureFilePath(setId, featureId);
        if (!relPath) {
          return;
        }
        const uri = vscode.Uri.joinPath(vscode.Uri.file(root), ...relPath.split('/'));
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc);
      },
    ),

    // Internal (not contributed to the palette): open a card's detail modal in
    // an already-open board panel. Used by automation and the demo driver.
    vscode.commands.registerCommand(
      'repodoc.openCard',
      (boardId: unknown, cardId: unknown): boolean => {
        if (typeof boardId !== 'string' || typeof cardId !== 'string') {
          return false;
        }
        return BoardPanel.postOpenCard(boardId, cardId);
      },
    ),

    // Internal test/automation: bounce a message through an open board's
    // webview so the real webview->host channel is exercised.
    vscode.commands.registerCommand(
      'repodoc.bounceWebviewMessage',
      (boardId: unknown, message: unknown): boolean => {
        if (typeof boardId !== 'string' || !message || typeof message !== 'object') {
          return false;
        }
        return BoardPanel.postBounce(boardId, message as WebviewToHostMessage);
      },
    ),

    // Open (or reveal) a board and jump straight to a card's detail modal.
    // Used by card items in the Boards tree.
    vscode.commands.registerCommand(
      'repodoc.revealCard',
      (boardId: unknown, cardId: unknown): void => {
        if (typeof boardId === 'string' && typeof cardId === 'string') {
          BoardPanel.revealCard(context.extensionUri, store, boardId, cardId);
        }
      },
    ),

    // Open the file behind a Boards-tree card node (G-1: every surface has a
    // route to the file, because hand-editing is the fallback for everything
    // the UI cannot do).
    vscode.commands.registerCommand('repodoc.openCardFile', async (arg: unknown): Promise<void> => {
      const node = arg as { kind?: string; boardId?: string; cardId?: string } | undefined;
      if (node?.kind !== 'card' || !node.boardId || !node.cardId) {
        return;
      }
      const relPath = new CardBoardSource(store, node.boardId).cardFilePath(node.cardId);
      if (!relPath) {
        void vscode.window.showWarningMessage(
          `RepoDoc: could not find the file for card ${node.cardId}.`,
        );
        return;
      }
      await openRepoFile(root, relPath);
    }),

    // Copy a pasteable `<scope>/<id> — <title> (<path>)` reference for a card or
    // feature tree node — the same string the webview's "Copy ref" and
    // `repodoc card show` produce.
    vscode.commands.registerCommand('repodoc.copyRef', async (arg: unknown): Promise<void> => {
      const node = arg as
        | { kind?: string; boardId?: string; cardId?: string; setId?: string; featureId?: string }
        | undefined;
      if (node?.kind === 'card' && node.boardId && node.cardId) {
        await copyRefToClipboard(store.cardRef(node.boardId, node.cardId));
      } else if (node?.kind === 'feature' && node.setId && node.featureId) {
        await copyRefToClipboard(store.featureRef(node.setId, node.featureId));
      }
    }),

    // Open a board's or feature set's `.config.json` — columns, gates, labels
    // and fields are authored there.
    vscode.commands.registerCommand(
      'repodoc.openBoardConfig',
      async (arg: unknown): Promise<void> => {
        const node = arg as { kind?: string; ref?: { id?: string } } | undefined;
        const id = typeof arg === 'string' ? arg : node?.ref?.id;
        if (!id) {
          return;
        }
        const dir = node?.kind === 'featureSet' ? 'features' : 'boards';
        await openRepoFile(root, `${dir}/${id}/.config.json`);
      },
    ),

    // "Open source" from the Decisions tree and the decision reading view.
    vscode.commands.registerCommand(
      'repodoc.openDecisionSource',
      async (arg: unknown): Promise<void> => {
        const id = typeof arg === 'string' ? arg : (arg as { id?: string } | undefined)?.id;
        if (!id) {
          return;
        }
        const record = store.getDecision(id);
        if (!record) {
          return;
        }
        await openRepoFile(root, `decisions/${record.file}`);
      },
    ),

    // "Open source" from the Docs tree and the docs reading view.
    vscode.commands.registerCommand(
      'repodoc.openDocSource',
      async (arg: unknown): Promise<void> => {
        const relPath =
          typeof arg === 'string' ? arg : (arg as { relPath?: string } | undefined)?.relPath;
        if (!relPath) {
          return;
        }
        await openRepoFile(root, relPath);
      },
    ),

    // G-8: change a decision's status without leaving the tree.
    vscode.commands.registerCommand(
      'repodoc.setDecisionStatus',
      async (arg: unknown): Promise<void> => {
        const id = typeof arg === 'string' ? arg : (arg as { id?: string } | undefined)?.id;
        if (!id) {
          return;
        }
        const picked = await vscode.window.showQuickPick(['Proposed', 'Accepted', 'Superseded'], {
          placeHolder: 'Decision status',
        });
        if (!picked) {
          return;
        }
        store.setDecisionStatus(id, picked);
      },
    ),

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
      if (!name?.trim()) {
        return;
      }
      const id = store.createBoard(name.trim());
      BoardPanel.createOrShow(context.extensionUri, store, new CardBoardSource(store, id));
    }),

    vscode.commands.registerCommand('repodoc.newDecision', async () => {
      const title = await vscode.window.showInputBox({
        prompt: 'Decision title',
        placeHolder: 'e.g. Use PostgreSQL as the primary datastore',
      });
      if (!title?.trim()) {
        return;
      }
      const id = store.createDecision(title.trim());
      if (id) {
        MarkdownPanel.showDecision(context.extensionUri, store, id);
      }
    }),

    vscode.commands.registerCommand('repodoc.installAgentSkill', async () => {
      if (!root) {
        void vscode.window.showWarningMessage(
          'RepoDoc: open a folder first — there is no workspace to install a skill into.',
        );
        return;
      }
      const installed = new Set(skillManager.installed());
      type Item = vscode.QuickPickItem & { agent: AgentKind };
      const base: Array<{ agent: AgentKind; label: string }> = [
        { agent: 'claude', label: 'Claude Code' },
        { agent: 'opencode', label: 'OpenCode' },
      ];
      const items: Item[] = base.map((item) => ({
        agent: item.agent,
        label: item.label,
        detail: SKILL_TARGETS[item.agent],
        ...(installed.has(item.agent) ? { description: '(installed)' } : {}),
      }));
      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: 'Install the RepoDoc workflow skill for which agent?',
      });
      if (!picked) {
        return;
      }
      skillManager.install(picked.agent);
      void vscode.window.showInformationMessage(
        `RepoDoc: installed agent skill at ${SKILL_TARGETS[picked.agent]}`,
      );
    }),
  );

  return { store };
}

export function deactivate(): void {}

/**
 * Open a repo-relative file in an editor beside the RepoDoc views. The path is
 * containment-checked against the workspace root before opening.
 */
async function openRepoFile(root: string | undefined, relPath: string): Promise<void> {
  if (!root) {
    return;
  }
  const rootResolved = path.resolve(root);
  const abs = path.resolve(rootResolved, relPath);
  if (abs !== rootResolved && !abs.startsWith(rootResolved + path.sep)) {
    return;
  }
  try {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(abs));
    await vscode.window.showTextDocument(doc, { preview: false });
  } catch {
    void vscode.window.showWarningMessage(`RepoDoc: could not open ${relPath}`);
  }
}
