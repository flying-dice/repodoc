/**
 * Gherkin `.feature` parsing. Pure and tolerant: it never throws, it never
 * rejects a file, and it keeps only what RepoDoc renders — the feature name,
 * its description, its tags, and the scenarios it declares.
 *
 * This is deliberately NOT a full Gherkin implementation (no step parsing, no
 * data tables, no doc strings): RepoDoc shows features on a board, the test
 * runner is the one that has to understand the rest of the file.
 */

/** One scenario declared in a feature file, with the tags written above it. */
export interface ParsedScenario {
  /** Text after the `Scenario:` / `Scenario Outline:` / `Example:` keyword. */
  name: string;
  /** Tags on the lines directly above the scenario, e.g. `@wip`. */
  tags: string[];
}

/** A `.feature` file reduced to the pieces RepoDoc renders. */
export interface ParsedFeature {
  /** Text after `Feature:`; the file name (sans extension) when there is none. */
  title: string;
  /** Lines between the Feature line and the first keyword/tag line, trimmed. */
  description: string;
  /** Feature-level tags, e.g. `@status:specified`. */
  tags: string[];
  scenarios: ParsedScenario[];
}

/** Keywords that end a feature description and may open a scenario. */
const FEATURE_KEYWORD = /^Feature:\s*(.*)$/;
const SCENARIO_KEYWORD = /^(Scenario Outline|Scenario Template|Scenario|Example):\s*(.*)$/;
/** Keywords that end the description without declaring a scenario. */
const OTHER_KEYWORD = /^(Background|Rule|Examples|Scenarios):/;

/**
 * Index of the line where a file's OWN tag lines stop: the `Feature:` line when
 * there is one, else the first scenario/`Rule:`/`Background:` line, else the
 * end of the file. Tags ABOVE it belong to the file (its `@status:` among
 * them); tags below it belong to the scenario underneath them.
 *
 * {@link parseFeature} and `writeStatusTag` both measure the region here, so
 * the tag the board reads is always the tag a move rewrites. A file with no
 * `Feature:` line used to hand its first tag line to the scenario below it,
 * while a move happily rewrote that same line — the board then showed a column
 * the file did not claim.
 */
export function featureTagRegionEnd(lines: readonly string[]): number {
  const featureIdx = lines.findIndex((l) => FEATURE_KEYWORD.test(l.trim()));
  if (featureIdx !== -1) {
    return featureIdx;
  }
  const keywordIdx = lines.findIndex(
    (l) => SCENARIO_KEYWORD.test(l.trim()) || OTHER_KEYWORD.test(l.trim()),
  );
  return keywordIdx === -1 ? lines.length : keywordIdx;
}

/**
 * Parses one `.feature` file. `fileName` is used only as the title fallback for
 * a file with no `Feature:` line — such a file still parses so a stray feature
 * is never invisible on the board, and the tags it declares before its first
 * scenario (its `@status:` among them) still count as the feature's own, so the
 * board agrees with the tag a move would rewrite.
 */
export function parseFeature(fileName: string, content: string): ParsedFeature {
  const parsed: ParsedFeature = {
    title: featureIdFromFileName(fileName),
    description: '',
    tags: [],
    scenarios: [],
  };

  let pendingTags: string[] = [];
  let sawFeature = false;
  let inDescription = false;
  const descriptionLines: string[] = [];

  const lines = content.split('\n');
  const tagRegionEnd = featureTagRegionEnd(lines);

  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? '').trim();
    if (line === '' || line.startsWith('#')) {
      // Blank lines and comments are transparent: they neither detach pending
      // tags from the keyword below them nor end a description.
      if (inDescription && line === '') {
        descriptionLines.push('');
      }
      continue;
    }
    if (line.startsWith('@')) {
      if (i < tagRegionEnd) {
        parsed.tags = parsed.tags.concat(tagsOnLine(line)); // the file's own
      } else {
        pendingTags = pendingTags.concat(tagsOnLine(line)); // the scenario below
      }
      inDescription = false;
      continue;
    }

    const featureName = FEATURE_KEYWORD.exec(line)?.[1];
    if (featureName !== undefined && !sawFeature) {
      sawFeature = true;
      parsed.title = featureName.trim() || featureIdFromFileName(fileName);
      inDescription = true;
      continue;
    }

    const scenarioName = SCENARIO_KEYWORD.exec(line)?.[2];
    if (scenarioName !== undefined) {
      parsed.scenarios.push({ name: scenarioName.trim(), tags: pendingTags });
      pendingTags = [];
      inDescription = false;
      continue;
    }

    if (OTHER_KEYWORD.test(line)) {
      pendingTags = [];
      inDescription = false;
      continue;
    }

    if (inDescription) {
      descriptionLines.push(line);
    }
  }

  parsed.description = descriptionLines.join('\n').trim();
  return parsed;
}

/** The `@tag` tokens on one tag line; `@` alone is not a tag. */
function tagsOnLine(line: string): string[] {
  return (line.match(/@\S+/g) ?? []).filter((t) => t.length > 1);
}

/** Feature id: the file name without its `.feature` extension. */
export function featureIdFromFileName(fileName: string): string {
  return fileName.replace(/\.feature$/i, '');
}

/** Prefix of the tag that carries a feature's column, e.g. `@status:doing`. */
export const STATUS_TAG_PREFIX = '@status:';

/** The column id carried by a `@status:` tag, or `undefined` when absent. */
export function statusFromTags(tags: string[]): string | undefined {
  const tag = tags.find((t) => t.startsWith(STATUS_TAG_PREFIX));
  const value = tag?.slice(STATUS_TAG_PREFIX.length).trim();
  return value ? value : undefined;
}

/** The tags with the `@status:` tag removed — what the card shows as labels. */
export function tagsWithoutStatus(tags: string[]): string[] {
  return tags.filter((t) => !t.startsWith(STATUS_TAG_PREFIX));
}
