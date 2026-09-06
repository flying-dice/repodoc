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
 * Parses one `.feature` file. `fileName` is used only as the title fallback for
 * a file with no `Feature:` line — such a file still parses so a stray feature
 * is never invisible on the board.
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

  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) {
      // Blank lines and comments are transparent: they neither detach pending
      // tags from the keyword below them nor end a description.
      if (inDescription && line === '') {
        descriptionLines.push('');
      }
      continue;
    }
    if (line.startsWith('@')) {
      pendingTags = pendingTags.concat(tagsOnLine(line));
      inDescription = false;
      continue;
    }

    const feature = FEATURE_KEYWORD.exec(line);
    if (feature && !sawFeature) {
      sawFeature = true;
      parsed.title = feature[1].trim() || featureIdFromFileName(fileName);
      parsed.tags = pendingTags;
      pendingTags = [];
      inDescription = true;
      continue;
    }

    const scenario = SCENARIO_KEYWORD.exec(line);
    if (scenario) {
      parsed.scenarios.push({ name: scenario[2].trim(), tags: pendingTags });
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
