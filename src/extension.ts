import * as vscode from 'vscode';
import { RepoDocStore } from './core/store';
import { AgentKind, SKILL_TARGETS, SkillManager } from './core/skillManager';
import { NodeFileSystemAdapter } from './adapters/nodeFileSystem';
import { MemFileSystemAdapter } from './adapters/memFileSystem';
import { SystemClock } from './adapters/systemClock';
import { BoardsTreeProvider, DecisionsTreeProvider, DocsTreeProvider } from './trees';
import { BoardPanel } from './panels/boardPanel';
import { MarkdownPanel } from './panels/markdownPanel';

/** Public surface returned by {@link activate}, used by e2e tests. */
export interface RepoDocApi {
  store: RepoDocStore;
}

export function activate(context: vscode.ExtensionContext): RepoDocApi {
  const folders = vscode.workspace.workspaceFolders;
  const root = folders && folders.length > 0 ? folders[0].uri.fsPath : undefined;
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
    for (const pattern of ['**/boards/**', '**/decisions/**', '**/docs/**']) {
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

    vscode.commands.registerCommand('repodoc.openBoard', (arg: unknown) => {
      // Invoked with a board id (tree item command / API) or with the tree
      // node itself (inline action / context menu).
      const boardId =
        typeof arg === 'string'
          ? arg
          : ((arg as { kind?: string; ref?: { id?: string } } | undefined)?.kind === 'board'
              ? (arg as { ref: { id: string } }).ref.id
              : undefined);
      if (boardId) {
        BoardPanel.createOrShow(context.extensionUri, store, boardId);
      }
    }),

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

    vscode.commands.registerCommand('repodoc.plantUmlStart', async () => {
      const docker = MarkdownPanel.plantUmlDocker();
      if (!(await docker.dockerAvailable())) {
        void vscode.window.showWarningMessage(
          'RepoDoc: Docker is not available — install/start Docker to run the local PlantUML renderer.',
        );
        return;
      }
      void vscode.window.showInformationMessage('RepoDoc: starting the PlantUML renderer…');
      const up = await docker.ensureStarted();
      void vscode.window.showInformationMessage(
        up
          ? `RepoDoc: PlantUML renderer running at ${docker.localUrl()}`
          : 'RepoDoc: the PlantUML container failed to start (see Docker logs).',
      );
      MarkdownPanel.refreshAll();
    }),

    vscode.commands.registerCommand('repodoc.plantUmlStop', async () => {
      const stopped = await MarkdownPanel.plantUmlDocker().stop();
      void vscode.window.showInformationMessage(
        stopped ? 'RepoDoc: PlantUML renderer stopped.' : 'RepoDoc: no PlantUML container to stop.',
      );
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
        description: installed.has(item.agent) ? '(installed)' : undefined,
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

export function deactivate(): void {
  // Best-effort: tear down a PlantUML container this session started.
  MarkdownPanel.plantUmlDocker().stopIfStartedByUs();
}
