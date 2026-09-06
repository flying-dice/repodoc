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
  DEFAULT_COLUMN_COLOR,
  DEFAULT_LABELS,
  defaultColumns,
  normalizeBoardConfig,
  RESERVED_CARD_KEYS,
  readBoardConfigFile,
  toColumns,
} from './boardConfig';
export type { BodySection } from './cardBody';
export {
  appendChecklistLine,
  appendCommentLine,
  appendSection,
  DESCRIPTION_END_RE,
  findDescription,
  findSection,
  replaceDescription,
  replaceTitle,
  upsertGateLine,
} from './cardBody';
export type { CardEntry } from './cardParse';
export { findChecklist, findComments, findGates, parseCard } from './cardParse';
export { DECISION_STATUSES, DecisionStore } from './decisions';
export { DocStore } from './docs';
export type { Eol } from './eol';
export { applyEol, detectEol, normalizeEol } from './eol';
export type { NewScenario, ScenarioPatch } from './featureBody';
export {
  addScenario,
  removeScenario,
  setFeatureDescription,
  setFeatureTitle,
  setScenario,
} from './featureBody';
export type {
  LineSpan,
  ParsedFeature,
  ParsedScenario,
  ScenarioKeyword,
} from './featureParse';
export {
  commonIndent,
  featureIdFromFileName,
  parseFeature,
  STATUS_TAG_PREFIX,
  statusFromTags,
  tagsWithoutStatus,
} from './featureParse';
export type { FeatureMetaPatch } from './features';
export { defaultFeatureColumns, FeatureStore, writeStatusTag } from './features';
export type { Frontmatter, FrontmatterEntry } from './frontmatter';
export { parseFrontmatter, serializeFrontmatter } from './frontmatter';
export {
  checkValue,
  defaultGatePrompt,
  evaluateGates,
  evaluateTransition,
  gatePromptText,
} from './gates';
export { pad, slugFromFileName, slugify, titleCase, uniqueSlug } from './naming';
export { computeCardOrder } from './ordering';
export * from './ports';
export { formatRef } from './refs';
export { seedBoardConfig } from './seed';
export { SKILL_MD, SKILL_NAME } from './skillContent';
export type { AgentKind } from './skillManager';
export { SKILL_TARGETS, SkillManager } from './skillManager';
export type { CardMetaPatch } from './store';
export { RepoDocStore } from './store';
export * from './types';
