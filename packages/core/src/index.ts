/**
 * @repodoc/core — the host-agnostic heart of RepoDoc.
 *
 * Everything the VS Code extension and the CLI do to a repository goes through
 * this package: parsing card files, evaluating gates, moving cards, recording
 * comments, reading decisions and docs. It never imports 'vscode'. The store
 * reaches the outside world only through the ports in `ports.ts`; the Node and
 * in-memory adapters ship here too so every host wires the same pieces.
 */
export * from './types';
export * from './ports';
export { RepoDocStore } from './store';
export type { AddCardResult, CardMetaPatch, MoveCardResult, StoreError } from './store';
export { parseFrontmatter, serializeFrontmatter } from './frontmatter';
export { parseCard, findChecklist, findComments, findGates } from './cardParse';
export type { CardEntry } from './cardParse';
export {
  DEFAULT_LABELS,
  defaultColumns,
  normalizeBoardConfig,
} from './boardConfig';
export type { BoardConfig, ConfigColumn } from './boardConfig';
export { RESERVED_CARD_KEYS } from './boardConfig';
export { evaluateGates, evaluateTransition, checkValue } from './gates';
export { computeCardOrder } from './ordering';
export { pad, slugFromFileName, slugify, titleCase } from './naming';
export { SkillManager, SKILL_TARGETS } from './skillManager';
export type { AgentKind } from './skillManager';
export { SKILL_MD, SKILL_NAME } from './skillContent';
export { seedBoardConfig } from './seed';
export { DecisionStore } from './decisions';
export { FeatureStore, defaultFeatureColumns, writeStatusTag } from './features';
export {
  parseFeature,
  featureIdFromFileName,
  statusFromTags,
  tagsWithoutStatus,
  STATUS_TAG_PREFIX,
} from './featureParse';
export type { ParsedFeature, ParsedScenario } from './featureParse';
export { DocStore } from './docs';
export { NodeFileSystemAdapter } from './adapters/nodeFileSystem';
export { MemFileSystemAdapter } from './adapters/memFileSystem';
export { SystemClock } from './adapters/systemClock';
