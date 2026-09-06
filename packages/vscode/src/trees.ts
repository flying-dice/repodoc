import type { BoardRef, DecisionRecord, DocNode, FeatureSetRef, RepoDocStore } from '@repodoc/core';
import * as vscode from 'vscode';

/**
 * Base class for tree providers that expose a `refresh()` which fires the
 * `onDidChangeTreeData` event. Subclasses implement `getTreeItem`/`getChildren`.
 */
abstract class RefreshableTreeProvider<T> implements vscode.TreeDataProvider<T> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData: vscode.Event<void> = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  abstract getTreeItem(element: T): vscode.TreeItem;
  abstract getChildren(element?: T): T[];
}

/**
 * A node in the rich Boards tree: board → columns → cards, then the feature
 * sets after them — set → columns → features. Feature nodes open the
 * `.feature` file itself; there is no card modal for a feature.
 */
export type BoardsNode =
  | { kind: 'board'; ref: BoardRef }
  | { kind: 'column'; boardId: string; columnId: string; name: string; count: number }
  | {
      kind: 'card';
      boardId: string;
      columnId: string;
      /** Position in the column — part of the TreeItem id (see getTreeItem). */
      index: number;
      cardId: string;
      title: string;
      priority?: string;
    }
  | { kind: 'featureSet'; ref: FeatureSetRef }
  | { kind: 'featureColumn'; setId: string; columnId: string; name: string; count: number }
  | {
      kind: 'feature';
      setId: string;
      columnId: string;
      index: number;
      featureId: string;
      title: string;
    };

export class BoardsTreeProvider extends RefreshableTreeProvider<BoardsNode> {
  constructor(private readonly store: RepoDocStore) {
    super();
  }

  getTreeItem(node: BoardsNode): vscode.TreeItem {
    if (node.kind === 'board') {
      const item = new vscode.TreeItem(node.ref.name, vscode.TreeItemCollapsibleState.Expanded);
      item.id = `board:${node.ref.id}`;
      item.description = String(node.ref.cardCount);
      item.iconPath = new vscode.ThemeIcon('project');
      item.contextValue = 'repodoc.board';
      item.command = {
        command: 'repodoc.openBoard',
        title: 'Open Board',
        arguments: [node.ref.id],
      };
      return item;
    }
    if (node.kind === 'featureSet') {
      const item = new vscode.TreeItem(node.ref.name, vscode.TreeItemCollapsibleState.Collapsed);
      item.id = `featureSet:${node.ref.id}`;
      item.description = String(node.ref.featureCount);
      item.iconPath = new vscode.ThemeIcon('beaker');
      item.contextValue = 'repodoc.featureSet';
      item.command = {
        command: 'repodoc.openBoard',
        title: 'Open Feature Set',
        arguments: [node],
      };
      return item;
    }
    if (node.kind === 'featureColumn') {
      const item = new vscode.TreeItem(
        node.name,
        node.count > 0
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None,
      );
      item.id = `featureColumn:${node.setId}:${node.columnId}`;
      item.description = String(node.count);
      item.iconPath = new vscode.ThemeIcon('layout-panel-left');
      item.contextValue = 'repodoc.column';
      return item;
    }
    if (node.kind === 'feature') {
      const item = new vscode.TreeItem(node.title, vscode.TreeItemCollapsibleState.None);
      // Keyed by position, not id: two files can map to the same id, and VS
      // Code drops the whole tree when two items share one id.
      item.id = `feature:${node.setId}:${node.columnId}:${node.index}`;
      item.tooltip = node.title;
      item.iconPath = new vscode.ThemeIcon('file-code');
      item.contextValue = 'repodoc.feature';
      item.command = {
        command: 'repodoc.openFeature',
        title: 'Open Feature',
        arguments: [node.setId, node.featureId],
      };
      return item;
    }
    if (node.kind === 'column') {
      const item = new vscode.TreeItem(
        node.name,
        node.count > 0
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None,
      );
      item.id = `column:${node.boardId}:${node.columnId}`;
      item.description = String(node.count);
      item.iconPath = new vscode.ThemeIcon('layout-panel-left');
      item.contextValue = 'repodoc.column';
      return item;
    }
    const item = new vscode.TreeItem(node.title, vscode.TreeItemCollapsibleState.None);
    // Keyed by position, not id — see the feature node above.
    item.id = `card:${node.boardId}:${node.columnId}:${node.index}`;
    item.tooltip = node.title;
    item.iconPath = new vscode.ThemeIcon('circle-filled', priorityColor(node.priority));
    item.contextValue = 'repodoc.card';
    item.command = {
      command: 'repodoc.revealCard',
      title: 'Open Card',
      arguments: [node.boardId, node.cardId],
    };
    return item;
  }

  getChildren(element?: BoardsNode): BoardsNode[] {
    if (!element) {
      return [
        ...this.store.listBoards().map((ref) => ({ kind: 'board' as const, ref })),
        ...this.store.listFeatureSets().map((ref) => ({ kind: 'featureSet' as const, ref })),
      ];
    }
    if (element.kind === 'featureSet') {
      const board = this.store.getFeatureSet(element.ref.id);
      if (!board) {
        return [];
      }
      return board.columns.map((c) => ({
        kind: 'featureColumn' as const,
        setId: element.ref.id,
        columnId: c.id,
        name: c.name,
        count: c.cardIds.length,
      }));
    }
    if (element.kind === 'featureColumn') {
      const board = this.store.getFeatureSet(element.setId);
      const column = board?.columns.find((c) => c.id === element.columnId);
      if (!board || !column) {
        return [];
      }
      return column.cardIds
        .map((id) => board.cards[id])
        .filter((card) => !!card)
        .map((card, index) => ({
          kind: 'feature' as const,
          setId: element.setId,
          columnId: element.columnId,
          index,
          featureId: card.id,
          title: card.title,
        }));
    }
    if (element.kind === 'board') {
      const board = this.store.getBoard(element.ref.id);
      if (!board) {
        return [];
      }
      return board.columns.map((c) => ({
        kind: 'column' as const,
        boardId: element.ref.id,
        columnId: c.id,
        name: c.name,
        count: c.cardIds.length,
      }));
    }
    if (element.kind === 'column') {
      const board = this.store.getBoard(element.boardId);
      const column = board?.columns.find((c) => c.id === element.columnId);
      if (!board || !column) {
        return [];
      }
      return column.cardIds
        .map((id) => board.cards[id])
        .filter((card) => !!card)
        .map((card, index) => ({
          kind: 'card' as const,
          boardId: element.boardId,
          columnId: element.columnId,
          index,
          cardId: card.id,
          title: card.title,
          ...(card.priority !== undefined ? { priority: card.priority } : {}),
        }));
    }
    return [];
  }
}

function priorityColor(priority?: string): vscode.ThemeColor {
  switch (priority) {
    case 'high':
      return new vscode.ThemeColor('charts.red');
    case 'med':
      return new vscode.ThemeColor('charts.yellow');
    default:
      return new vscode.ThemeColor('charts.lines');
  }
}

export class DecisionsTreeProvider extends RefreshableTreeProvider<DecisionRecord> {
  constructor(private readonly store: RepoDocStore) {
    super();
  }

  getTreeItem(record: DecisionRecord): vscode.TreeItem {
    const item = new vscode.TreeItem(record.title, vscode.TreeItemCollapsibleState.None);
    item.description = record.num;
    item.tooltip = record.file;
    item.contextValue = 'repodoc.decision';
    item.iconPath = new vscode.ThemeIcon(
      'circle-filled',
      new vscode.ThemeColor(statusColor(record.status)),
    );
    item.command = {
      command: 'repodoc.openDecision',
      title: 'Open Decision',
      arguments: [record.id],
    };
    return item;
  }

  getChildren(element?: DecisionRecord): DecisionRecord[] {
    if (element) {
      return [];
    }
    return this.store.listDecisions();
  }
}

function statusColor(status: string): string {
  switch (status.toLowerCase()) {
    case 'accepted':
      return 'charts.green';
    case 'proposed':
      return 'charts.yellow';
    case 'superseded':
      return 'charts.lines';
    default:
      return 'charts.lines';
  }
}

export class DocsTreeProvider extends RefreshableTreeProvider<DocNode> {
  constructor(private readonly store: RepoDocStore) {
    super();
  }

  getTreeItem(node: DocNode): vscode.TreeItem {
    if (node.type === 'dir') {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
      item.tooltip = node.relPath;
      item.contextValue = 'repodoc.docDir';
      item.iconPath = vscode.ThemeIcon.Folder;
      return item;
    }
    const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
    item.tooltip = node.relPath;
    item.contextValue = 'repodoc.docFile';
    item.iconPath = new vscode.ThemeIcon('markdown');
    item.command = {
      command: 'repodoc.openDoc',
      title: 'Open Doc',
      arguments: [node.relPath],
    };
    return item;
  }

  getChildren(element?: DocNode): DocNode[] {
    if (!element) {
      return this.store.getDocsTree();
    }
    if (element.type === 'dir' && element.children) {
      return element.children;
    }
    return [];
  }
}
