import type {
  BoardData,
  CardMetaPatch,
  CustomFieldValue,
  GatedMoveResult,
  GateOverride,
  GateResult,
  RepoDocConfig,
  RepoDocStore,
} from '@repodoc/core';
import type { BoardCapabilities } from './protocol';

/**
 * What the board webview needs from whatever it is showing. Two things render
 * on the kanban surface — a card board and a feature set — and they differ only
 * in which mutations they support, so the panel talks to this interface instead
 * of to the store directly.
 *
 * Each source DECLARES what it supports in `capabilities`; the panel forwards
 * that to the webview, which hides the affordances a surface does not have. The
 * matching methods are optional so a source only implements what it declares.
 */
export interface BoardSource {
  readonly kind: 'board' | 'features';
  readonly id: string;
  /** Which editing affordances this surface supports (see protocol.ts). */
  readonly capabilities: BoardCapabilities;
  getBoard(): BoardData | undefined;
  getConfig(): RepoDocConfig;
  /** The data directory shown in the status bar, e.g. `boards/<id>/`. */
  displayPath(): string;
  /**
   * Move a card, gates and all: the source refuses without writing when a gate
   * blocks and no `override` (with a reason) is given, and journals one override
   * per blocking gate when it is. The policy itself lives in core, so this
   * surface and `repodoc card move` behave identically — there is deliberately
   * no ungated move here for a caller to reach for.
   */
  moveCardGated(
    cardId: string,
    toColumn: string,
    index: number,
    options: { override?: GateOverride },
  ): GatedMoveResult;
  addCard(column: string, title: string): void;
  /** Gates guarding a move; `[]` when the source does not gate moves. */
  evaluateMove(cardId: string, toColumn: string): GateResult[];
  /**
   * The repo-relative file backing a card, for the host's "Open file" action.
   * `undefined` when it cannot be resolved (no workspace root, missing file).
   */
  cardFilePath?(cardId: string): string | undefined;
  /** The pasteable reference for a card, see `formatRef` in @repodoc/core. */
  cardRef(cardId: string): string | undefined;
  addComment?(cardId: string, who: string, text: string): void;
  setCardField?(cardId: string, fieldId: string, value: CustomFieldValue | undefined): void;
  toggleChecklistItem?(cardId: string, index: number): void;
  addChecklistItem?(cardId: string, text: string): void;
  setCardDescription?(cardId: string, text: string): void;
  updateCardMeta?(cardId: string, patch: CardMetaPatch): void;
  recordGateEvidence?(cardId: string, gateId: string, result: string, who: string): void;
  addColumn?(name: string): void;
}

/** A `boards/<id>/` card board — the full set of board behaviours. */
export class CardBoardSource implements BoardSource {
  readonly kind = 'board' as const;

  /** A card board supports every board behaviour. */
  readonly capabilities: BoardCapabilities = {
    comments: true,
    fields: true,
    checklist: true,
    checklistAdd: true,
    addColumn: true,
    meta: true,
    description: true,
    gateEvidence: true,
  };

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

  moveCardGated(
    cardId: string,
    toColumn: string,
    index: number,
    options: { override?: GateOverride },
  ): GatedMoveResult {
    return this.store.moveCardGated(this.id, cardId, toColumn, index, options);
  }

  addCard(column: string, title: string): void {
    this.store.addCard(this.id, column, title);
  }

  evaluateMove(cardId: string, toColumn: string): GateResult[] {
    return this.store.evaluateMove(this.id, cardId, toColumn);
  }

  recordGateEvidence(cardId: string, gateId: string, result: string, who: string): void {
    this.store.recordGateEvidence(this.id, cardId, gateId, result, who);
  }

  updateCardMeta(cardId: string, patch: CardMetaPatch): void {
    this.store.updateCardMeta(this.id, cardId, patch);
  }

  cardFilePath(cardId: string): string | undefined {
    return this.store.cardFilePath(this.id, cardId);
  }

  cardRef(cardId: string): string | undefined {
    return this.store.cardRef(this.id, cardId);
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

  addChecklistItem(cardId: string, text: string): void {
    this.store.addChecklistItem(this.id, cardId, text);
  }

  setCardDescription(cardId: string, text: string): void {
    this.store.setCardDescription(this.id, cardId, text);
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

  /**
   * A feature's content is owned by its `.feature` file, so the board surface
   * offers no editing beyond moving (the `@status:` tag) and adding a file.
   */
  readonly capabilities: BoardCapabilities = {
    comments: false,
    fields: false,
    checklist: false,
    checklistAdd: false,
    addColumn: false,
    meta: false,
    description: false,
    gateEvidence: false,
  };

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

  moveCardGated(cardId: string, toColumn: string): GatedMoveResult {
    // Feature files are never renumbered — order inside a column is file order —
    // and gates are not enforced for features, so nothing can block or override.
    const moved = this.store.moveFeature(this.id, cardId, toColumn);
    return moved.ok ? { ok: true, overridden: [] } : { ok: false, error: moved.error };
  }

  addCard(column: string, title: string): void {
    this.store.createFeature(this.id, title, column);
  }

  evaluateMove(): GateResult[] {
    return []; // gates are not enforced for features in this iteration
  }

  /** The `.feature` file itself — source code, so "Open file" is a must. */
  cardRef(featureId: string): string | undefined {
    return this.store.featureRef(this.id, featureId);
  }

  cardFilePath(featureId: string): string | undefined {
    return this.store.featureFilePath(this.id, featureId);
  }
}
