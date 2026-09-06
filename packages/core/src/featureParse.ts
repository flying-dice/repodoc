/**
 * Gherkin `.feature` parsing. Pure and tolerant: it never throws, it never
 * rejects a file, and it keeps only what RepoDoc renders — the feature name,
 * its description, its tags, and the scenarios it declares.
 *
 * This is deliberately NOT a full Gherkin implementation: steps, doc strings,
 * tables and `Examples:` are carried as the verbatim lines of the scenario they
 * sit in, never interpreted. RepoDoc shows features on a board, the test runner
 * is the one that has to understand the rest of the file.
 *
 * CRLF is normalised on read, so nothing a caller receives — a name, a tag, a
 * description or a step — ever carries a stray carriage return; line INDEXES
 * are unaffected, so the spans below address the file either way.
 *
 * Every scenario also carries its LINE SPAN, and the feature its description
 * span. `featureBody.ts` writes inside those spans and nowhere else, so an
 * edit made through RepoDoc rewrites the one construct it was asked to change
 * and leaves every other byte — tags, `Rule:`, `Background:`, comments — alone.
 */

/**
 * The keyword a scenario is declared with. `Background:` and `Rule:` are NOT
 * here: they bound a scenario's span but never become one, so a scenario index
 * always addresses something a reader would call a scenario.
 */
export type ScenarioKeyword = 'Scenario' | 'Scenario Outline' | 'Scenario Template' | 'Example';

/** A half-open line span `[start, end)` of the file's lines. */
export interface LineSpan {
  start: number;
  end: number;
}

/** One scenario declared in a feature file, with the tags written above it. */
export interface ParsedScenario {
  /** Text after the `Scenario:` / `Scenario Outline:` / `Example:` keyword. */
  name: string;
  /** Tags on the lines directly above the scenario, e.g. `@wip`. */
  tags: string[];
  /** The keyword it was declared with — writers keep it as written. */
  keyword: ScenarioKeyword;
  /** Index of the `Scenario:` line itself. */
  headingLine: number;
  /** First line of the block: its own tag lines when it has any, else the heading. */
  start: number;
  /**
   * Exclusive end: where the next scenario / `Rule:` / `Background:` block
   * starts (its tag lines included), or the end of the file. The blank lines
   * that separate this block from the next are therefore INSIDE the span, so
   * deleting `[start, end)` leaves exactly one separation behind.
   */
  end: number;
  /**
   * The block's body below the heading — steps, doc strings, tables and
   * `Examples:` — dedented by the body's common indentation and with trailing
   * blank lines dropped. Verbatim otherwise: RepoDoc does not parse steps, it
   * carries them.
   */
  steps: string[];
}

/** A `.feature` file reduced to the pieces RepoDoc renders. */
export interface ParsedFeature {
  /** Text after `Feature:`; the file name (sans extension) when there is none. */
  title: string;
  /** Lines between the Feature line and the first keyword/tag line, trimmed. */
  description: string;
  /**
   * The line span {@link description} was read from — everything after the
   * `Feature:` line up to the first tag or keyword line. `{0, 0}` when the file
   * has no `Feature:` line. Reader and writer measure the description here, so
   * a saved description replaces exactly what was shown.
   */
  descriptionSpan: LineSpan;
  /** Index of the `Feature:` line, or undefined when the file has none. */
  featureLine: number | undefined;
  /** Feature-level tags, e.g. `@status:specified`. */
  tags: string[];
  scenarios: ParsedScenario[];
}

import { normalizeEol } from './eol';

/** Keywords that end a feature description and may open a scenario. */
const FEATURE_KEYWORD = /^Feature:\s*(.*)$/;
const SCENARIO_KEYWORD = /^(Scenario Outline|Scenario Template|Scenario|Example):\s*(.*)$/;
/** Keywords that end the description without declaring a scenario. */
const OTHER_KEYWORD = /^(Background|Rule|Examples|Scenarios):/;
/**
 * Keywords that CLOSE the scenario above them without opening one.
 * `Examples:` / `Scenarios:` are deliberately absent: they belong to the
 * Scenario Outline they sit under, so they are part of its span, not a
 * boundary — cutting the span there would strip an outline of its examples.
 */
const BLOCK_KEYWORD = /^(Background|Rule):/;

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
  const lines = normalizeEol(content).split('\n');
  const featureIdx = lines.findIndex((l) => FEATURE_KEYWORD.test(l.trim()));
  const parsed: ParsedFeature = {
    title: featureIdFromFileName(fileName),
    description: '',
    descriptionSpan: descriptionSpan(lines, featureIdx),
    featureLine: featureIdx === -1 ? undefined : featureIdx,
    tags: [],
    scenarios: [],
  };
  // Spans are measured once, up front: the loop below reads names and tags, and
  // looks the matching block up by its heading line.
  const blocks = new Map(blocksOf(lines).map((b) => [b.headingLine, b]));

  let pendingTags: string[] = [];
  let sawFeature = false;
  let inDescription = false;
  const descriptionLines: string[] = [];

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
    const block = blocks.get(i);
    if (scenarioName !== undefined && block?.keyword !== undefined) {
      parsed.scenarios.push({
        name: scenarioName.trim(),
        tags: pendingTags,
        keyword: block.keyword,
        headingLine: i,
        start: block.start,
        end: block.end,
        steps: stepsOf(lines, i, block.end),
      });
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

/** One scenario / `Rule:` / `Background:` block and the lines it owns. */
interface FeatureBlock {
  headingLine: number;
  start: number;
  end: number;
  /** Set only for blocks that ARE scenarios; `Rule:`/`Background:` leave it undefined. */
  keyword: ScenarioKeyword | undefined;
}

/**
 * Every block in the file, in order, each owning the lines from its own tag
 * lines down to where the next block's tag lines begin. A block never reaches
 * above {@link featureTagRegionEnd}: the tags up there are the FILE's (its
 * `@status:` among them), so removing the first scenario of a file with no
 * `Feature:` line must not take the feature's own tags with it.
 */
function blocksOf(lines: readonly string[]): FeatureBlock[] {
  const tagRegionEnd = featureTagRegionEnd(lines);
  const heads: Array<{ line: number; keyword: ScenarioKeyword | undefined }> = [];
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? '').trim();
    const keyword = SCENARIO_KEYWORD.exec(line)?.[1];
    if (keyword !== undefined) {
      heads.push({ line: i, keyword: keyword as ScenarioKeyword });
    } else if (BLOCK_KEYWORD.test(line)) {
      heads.push({ line: i, keyword: undefined });
    }
  }
  const starts = heads.map((h) => Math.max(tagRegionEnd, blockStart(lines, h.line)));
  return heads.map((h, i) => ({
    headingLine: h.line,
    start: starts[i] ?? h.line,
    end: starts[i + 1] ?? lines.length,
    keyword: h.keyword,
  }));
}

/**
 * The first line of the block headed at `headingLine`: the topmost tag line
 * above it, skipping blank and comment lines exactly as {@link parseFeature}
 * does when it attaches those tags. Any other content stops the walk — the
 * line above belongs to the block before this one.
 */
function blockStart(lines: readonly string[], headingLine: number): number {
  let start = headingLine;
  for (let i = headingLine - 1; i >= 0; i--) {
    const line = (lines[i] ?? '').trim();
    if (line.startsWith('@')) {
      start = i;
      continue;
    }
    if (line === '' || line.startsWith('#')) {
      continue;
    }
    break;
  }
  return start;
}

/**
 * The body of a block, dedented by its common indentation and with the blank
 * lines that separate it from the next block dropped. Nothing else is touched:
 * a doc string keeps its inner indentation relative to the step above it.
 */
function stepsOf(lines: readonly string[], headingLine: number, end: number): string[] {
  let last = end;
  while (last > headingLine + 1 && (lines[last - 1] ?? '').trim() === '') {
    last--;
  }
  const body = lines.slice(headingLine + 1, last);
  const indent = commonIndent(body);
  return body.map((l) =>
    indent !== '' && l.startsWith(indent) ? l.slice(indent.length) : l.trim(),
  );
}

/**
 * The longest leading-whitespace prefix shared by every non-blank line — the
 * indentation a block was written at, which its writer re-applies so an
 * unchanged save is byte-identical. Tabs and spaces are compared as written.
 */
export function commonIndent(lines: readonly string[]): string {
  let indent: string | undefined;
  for (const line of lines) {
    if (line.trim() === '') {
      continue;
    }
    const own = /^[ \t]*/.exec(line)?.[0] ?? '';
    if (indent === undefined) {
      indent = own;
      continue;
    }
    let i = 0;
    while (i < indent.length && i < own.length && indent[i] === own[i]) {
      i++;
    }
    indent = indent.slice(0, i);
  }
  return indent ?? '';
}

/**
 * The span the feature's description occupies: everything after the `Feature:`
 * line up to the first tag line or keyword line (which belong to what comes
 * next), or the end of the file. Empty when there is no `Feature:` line —
 * there is nothing for a description to hang off.
 */
function descriptionSpan(lines: readonly string[], featureIdx: number): LineSpan {
  if (featureIdx === -1) {
    return { start: 0, end: 0 };
  }
  const start = featureIdx + 1;
  for (let i = start; i < lines.length; i++) {
    const line = (lines[i] ?? '').trim();
    if (line.startsWith('@') || SCENARIO_KEYWORD.test(line) || OTHER_KEYWORD.test(line)) {
      return { start, end: i };
    }
  }
  return { start, end: lines.length };
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
