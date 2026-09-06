import type {
  BoardData,
  CustomFieldValue,
  GateResult,
  RepoDocConfig,
  RepoDocStore,
} from '@repodoc/core';

/**
 * What the board webview needs from whatever it is showing. Two things render
 * on the kanban surface — a card board and a feature set — and they differ only
 * in which mutations they support, so the panel talks to this interface instead
 * of to the store directly.
 *
 * The OPTIONAL methods are the capabilities: a source that cannot journal
 * comments simply does not implement `addComment`, and the panel tells the
 * webview to hide that affordance (see `capabilities` in protocol.ts).
 */
export interface BoardSource {
  readonly kind: 'board' | 'features';
  readonly id: string;
  getBoard(): BoardData | undefined;
  getConfig(): RepoDocConfig;
  /** The data directory shown in the status bar, e.g. `boards/<id>/`. */
  displayPath(): string;
  moveCard(cardId: string, toColumn: string, index: number): void;
  addCard(column: string, title: string): void;
  /** Gates guarding a move; `[]` when the source does not gate moves. */
  evaluateMove(cardId: string, toColumn: string): GateResult[];
  recordGateOverride(cardId: string, gateId: string, who: string, reason?: string): void;
  addComment?(cardId: string, who: string, text: string): void;
  setCardField?(cardId: string, fieldId: string, value: CustomFieldValue | undefined): void;
  toggleChecklistItem?(cardId: string, index: number): void;
  addColumn?(name: string): void;
}

/** A `boards/<id>/` card board — the full set of board behaviours. */
export class CardBoardSource implements BoardSource {
  readonly kind = 'board' as const;

  constructor(
    private readonly store: RepoDocStore,
    readonly id: string,
  ) {}

  getBoard(): BoardData | undefined {
    return this.store.getBoard(this.id);
  }

  getConfig(): RepoDocConfig {
    return this.store.getBoardConfig(this.id);
  }

  displayPath(): string {
    return this.store.displayPath(this.id);
  }

  moveCard(cardId: string, toColumn: string, index: number): void {
    this.store.moveCard(this.id, cardId, toColumn, index);
  }

  addCard(column: string, title: string): void {
    this.store.addCard(this.id, column, title);
  }

  evaluateMove(cardId: string, toColumn: string): GateResult[] {
    return this.store.evaluateMove(this.id, cardId, toColumn);
  }

  recordGateOverride(cardId: string, gateId: string, who: string, reason?: string): void {
    this.store.recordGateOverride(this.id, cardId, gateId, who, reason);
  }

  addComment(cardId: string, who: string, text: string): void {
    this.store.addComment(this.id, cardId, who, text);
  }

  setCardField(cardId: string, fieldId: string, value: CustomFieldValue | undefined): void {
    this.store.setCardField(this.id, cardId, fieldId, value);
  }

  toggleChecklistItem(cardId: string, index: number): void {
    this.store.toggleChecklistItem(this.id, cardId, index);
  }

  addColumn(name: string): void {
    this.store.addColumn(this.id, name);
  }
}

/**
 * A `features/<id>/` feature set. Moving rewrites a feature's `@status:` tag and
 * adding writes a new `.feature` file; features carry no comments, custom
 * fields, checklists, or gates, and columns come from the set's config, so
 * those methods are deliberately absent.
 */
export class FeatureSetSource implements BoardSource {
  readonly kind = 'features' as const;

  constructor(
    private readonly store: RepoDocStore,
    readonly id: string,
  ) {}

  getBoard(): BoardData | undefined {
    return this.store.getFeatureSet(this.id);
  }

  getConfig(): RepoDocConfig {
    return this.store.getFeatureSetConfig(this.id);
  }

  displayPath(): string {
    return this.store.featureSetDisplayPath(this.id);
  }

  moveCard(cardId: string, toColumn: string, _index: number): void {
    // Feature files are never renumbered — order inside a column is file order.
    this.store.moveFeature(this.id, cardId, toColumn);
  }

  addCard(column: string, title: string): void {
    this.store.createFeature(this.id, title, column);
  }

  evaluateMove(): GateResult[] {
    return []; // gates are not enforced for features in this iteration
  }

  recordGateOverride(): void {
    // No gates, so there is never anything to override.
  }
}
