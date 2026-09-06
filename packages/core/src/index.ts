/**
 * @repodoc/core — the host-agnostic heart of RepoDoc.
 *
 * Everything the VS Code extension and the CLI do to a repository goes through
 * this package: parsing card files, evaluating gates, moving cards, recording
 * comments, reading decisions and docs. It never imports 'vscode'. The store
 * reaches the outside world only through the ports in `ports.ts`; the Node and
 * in-memory adapters ship here too so every host wires the same pieces.
 */

export { MemFileSystemAdapter } from './adapters/memFileSystem';
export { NodeFileSystemAdapter } from './adapters/nodeFileSystem';
export { SystemClock } from './adapters/systemClock';
export type { BoardConfig, ConfigColumn } from './boardConfig';
export {
  DEFAULT_LABELS,
  defaultColumns,
  normalizeBoardConfig,
  RESERVED_CARD_KEYS,
} from './boardConfig';
export type { CardEntry } from './cardParse';
export { findChecklist, findComments, findGates, parseCard } from './cardParse';
export { DecisionStore } from './decisions';
export { DocStore } from './docs';
export type { ParsedFeature, ParsedScenario } from './featureParse';
export {
  featureIdFromFileName,
  parseFeature,
  STATUS_TAG_PREFIX,
  statusFromTags,
  tagsWithoutStatus,
} from './featureParse';
export { defaultFeatureColumns, FeatureStore, writeStatusTag } from './features';
export { parseFrontmatter, serializeFrontmatter } from './frontmatter';
export { checkValue, evaluateGates, evaluateTransition } from './gates';
export { pad, slugFromFileName, slugify, titleCase } from './naming';
export { computeCardOrder } from './ordering';
export * from './ports';
export { seedBoardConfig } from './seed';
export { SKILL_MD, SKILL_NAME } from './skillContent';
export type { AgentKind } from './skillManager';
export { SKILL_TARGETS, SkillManager } from './skillManager';
export type { AddCardResult, CardMetaPatch, MoveCardResult, StoreError } from './store';
export { RepoDocStore } from './store';
export * from './types';
