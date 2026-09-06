/**
 * Pure writers for a Gherkin `.feature` file. Every function takes the file
 * text and returns the new text — no I/O, no store. The store's feature
 * mutators are thin wrappers around these, which keeps "what a managed edit
 * rewrites" described in one place.
 *
 * The contract, and the reason this file exists:
 *
 *  - A `.feature` file is USER SOURCE owned by the test runner. A writer here
 *    rewrites the ONE construct it was asked to change and preserves every
 *    other byte: feature tags, scenario tags, `Rule:` and `Background:` blocks,
 *    comments, doc strings, tables, `Examples:`, and the file's own line
 *    endings. Nothing is reformatted, nothing is dropped for being unrecognised.
 *  - Every span comes from {@link parseFeature}, so the reader and the writer
 *    measure the same lines: what the UI showed is exactly what a save
 *    replaces, and nothing is duplicated or lost between the two.
 *  - Indentation is preserved by measuring it: a block is re-written at the
 *    indentation it was found at, so saving an unchanged value gives back a
 *    byte-identical file.
 *
 * Line endings are handled as everywhere else in RepoDoc: detect, normalise to
 * LF for processing, re-apply on the way out (see `eol.ts`).
 */

import { applyEol, detectEol, normalizeEol } from './eol';
import {
  commonIndent,
  featureTagRegionEnd,
  parseFeature,
  type ScenarioKeyword,
} from './featureParse';

/** A `Feature:` line at any indentation — the line a title edit rewrites. */
const FEATURE_LINE = /^\s*Feature:/;

/** The keyword a scenario added through the UI is written with. */
const DEFAULT_KEYWORD: ScenarioKeyword = 'Scenario';

/** What a managed edit may change about a scenario. Absent keys are left alone. */
export interface ScenarioPatch {
  /** New text after the keyword. Collapsed to one line. */
  name?: string;
  /** The block's body, one line per entry, replacing the existing body. */
  steps?: string[];
}

/** A scenario to append. `keyword` defaults to `Scenario`. */
export interface NewScenario {
  name: string;
  steps?: string[];
  keyword?: ScenarioKeyword;
}

/**
 * Rewrites the name on the file's `Feature:` line, keeping its indentation and
 * every other line. A file with no `Feature:` line gets one inserted directly
 * below its own tag lines (see `featureTagRegionEnd`) — above the first
 * scenario, so the tags that were the feature's stay the feature's.
 *
 * The title is collapsed to a single line: a newline in it would forge Gherkin
 * structure — everything after it would read as a description, or as a step.
 */
export function setFeatureTitle(text: string, title: string): string {
  const eol = detectEol(text);
  const lines = normalizeEol(text).split('\n');
  const heading = `Feature: ${oneLine(title)}`;

  const idx = lines.findIndex((l) => FEATURE_LINE.test(l));
  if (idx !== -1) {
    lines[idx] = `${indentOf(lines[idx] ?? '')}${heading}`;
    return applyEol(lines.join('\n'), eol);
  }

  let at = featureTagRegionEnd(lines);
  if (at >= lines.length && lines[lines.length - 1] === '') {
    at = lines.length - 1; // keep the file's trailing newline where it is
  }
  lines.splice(at, 0, heading);
  return applyEol(lines.join('\n'), eol);
}

/**
 * Replaces the feature's description — the lines between `Feature:` and the
 * first tag or keyword line — with `description`, separated from what is above
 * and below it by exactly one blank line and re-indented to the indentation the
 * description was already written at (two spaces when there was none). An empty
 * `description` removes it.
 *
 * Comment lines inside the span are KEPT, above the new text: the description
 * the UI shows excludes them ({@link parseFeature} skips comments), so a save
 * must not delete what was never on screen.
 *
 * A file with no `Feature:` line has nowhere to hang a description, and is
 * returned unchanged.
 */
export function setFeatureDescription(text: string, description: string): string {
  const eol = detectEol(text);
  const normalized = normalizeEol(text);
  const parsed = parseFeature('', normalized);
  if (parsed.featureLine === undefined) {
    return text;
  }
  const lines = normalized.split('\n');
  const { start, end } = parsed.descriptionSpan;
  const span = lines.slice(start, end);
  const comments = span.filter((l) => l.trim().startsWith('#'));
  const indent = commonIndent(span.filter((l) => !l.trim().startsWith('#'))) || '  ';

  const body = description.trim()
    ? normalizeEol(description)
        .trim()
        .split('\n')
        .map((l) => (l.trim() === '' ? '' : `${indent}${l}`))
    : [];

  return applyEol(splice(lines, start, end, comments.concat(body)), eol);
}

/**
 * Rewrites one scenario in place: its name on the heading line (the keyword it
 * was declared with is kept) and/or its body. `index` addresses
 * {@link parseFeature}'s `scenarios`, so `Rule:` and `Background:` blocks are
 * not counted and cannot be reached — those are preserved untouched, as are the
 * scenario's own tag lines and the blank lines around the block.
 *
 * The body is written at the indentation it already had (two spaces under the
 * heading when the scenario had no body), so re-saving an unchanged scenario
 * gives back a byte-identical file. A step carrying newlines becomes several
 * lines rather than one forged one.
 *
 * `undefined` when `index` names no scenario — nothing is written.
 */
export function setScenario(text: string, index: number, patch: ScenarioPatch): string | undefined {
  const eol = detectEol(text);
  const normalized = normalizeEol(text);
  const parsed = parseFeature('', normalized);
  const scenario = parsed.scenarios[index];
  if (!scenario) {
    return undefined;
  }
  const lines = normalized.split('\n');
  const headingLine = lines[scenario.headingLine] ?? '';
  const headIndent = indentOf(headingLine);

  if (patch.name !== undefined) {
    lines[scenario.headingLine] = `${headIndent}${scenario.keyword}: ${oneLine(patch.name)}`;
  }
  if (patch.steps !== undefined) {
    // The body stops before the blank lines that separate this block from the
    // next: they are the file's spacing, not the scenario's content.
    let bodyEnd = scenario.end;
    while (bodyEnd > scenario.headingLine + 1 && (lines[bodyEnd - 1] ?? '').trim() === '') {
      bodyEnd--;
    }
    const indent =
      commonIndent(lines.slice(scenario.headingLine + 1, bodyEnd)) || `${headIndent}  `;
    const body = stepLines(patch.steps, indent);
    lines.splice(scenario.headingLine + 1, bodyEnd - scenario.headingLine - 1, ...body);
  }
  return applyEol(lines.join('\n'), eol);
}

/**
 * Appends a scenario at the end of the file, separated by one blank line and
 * terminated by a newline. It is written at the indentation the file's last
 * scenario uses (two spaces when there is none), so an added scenario looks
 * like the ones already there.
 *
 * Appending is deliberate: inserting into the middle would renumber the
 * scenario indexes the UI and the CLI are holding, and a feature file's order
 * is the author's.
 */
export function addScenario(text: string, scenario: NewScenario): string {
  const eol = detectEol(text);
  const normalized = normalizeEol(text);
  const parsed = parseFeature('', normalized);
  const lines = normalized.split('\n');

  const last = parsed.scenarios[parsed.scenarios.length - 1];
  const headIndent = last === undefined ? '  ' : indentOf(lines[last.headingLine] ?? '');
  const bodyIndent =
    last === undefined
      ? `${headIndent}  `
      : commonIndent(lines.slice(last.headingLine + 1, last.end)) || `${headIndent}  `;

  const keyword = scenario.keyword ?? DEFAULT_KEYWORD;
  const block = [
    `${headIndent}${keyword}: ${oneLine(scenario.name)}`,
    ...stepLines(scenario.steps ?? [], bodyIndent),
  ];

  // Anchored at a newline so only whole blank lines are dropped — trailing
  // spaces on the last content line are part of that line (see cardBody.ts).
  const trimmed = normalized.trim() === '' ? '' : normalized.replace(/(?:\n[ \t]*)+$/, '');
  const prefix = trimmed.length ? `${trimmed}\n\n` : '';
  return applyEol(`${prefix}${block.join('\n')}\n`, eol);
}

/**
 * Removes one scenario: its heading, its body, its own tag lines, and the blank
 * lines separating it from what follows — so the file is left with exactly one
 * separation where two blocks met, and everything else untouched.
 *
 * `undefined` when `index` names no scenario — nothing is written.
 */
export function removeScenario(text: string, index: number): string | undefined {
  const eol = detectEol(text);
  const normalized = normalizeEol(text);
  const parsed = parseFeature('', normalized);
  const scenario = parsed.scenarios[index];
  if (!scenario) {
    return undefined;
  }
  const lines = normalized.split('\n');
  const wasLast = scenario.end >= lines.length;
  const endsWithNewline = lines[lines.length - 1] === '';
  lines.splice(scenario.start, scenario.end - scenario.start);
  if (wasLast) {
    // Removing the LAST block takes the end of the file with it: drop the blank
    // lines that used to separate it, and put back the trailing newline the
    // file had (or did not have).
    while (lines.length && (lines[lines.length - 1] ?? '').trim() === '') {
      lines.pop();
    }
    if (endsWithNewline) {
      lines.push('');
    }
  }
  return applyEol(lines.join('\n'), eol);
}

/**
 * Body lines at `indent`. A step carrying newlines becomes one line each, and
 * trailing blank lines are dropped: they are separation between blocks, not
 * content — a textarea that ends with a newline, or a `--step ""`, must not
 * push the next scenario down the file on every save.
 */
function stepLines(steps: readonly string[], indent: string): string[] {
  const lines = steps
    .flatMap((step) => normalizeEol(step).split('\n'))
    .map((line) => (line.trim() === '' ? '' : `${indent}${line}`));
  while (lines.length && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

/**
 * Replaces `lines[start, end)` with `middle`, separated from the lines above
 * and below by exactly one blank line, and keeps the file's trailing newline.
 * The same shape as `cardBody.replaceDescription` — an empty group contributes
 * no separator, so clearing a block does not leave two blank lines behind.
 */
function splice(lines: string[], start: number, end: number, middle: string[]): string {
  const before = lines.slice(0, start);
  const after = lines.slice(end);
  const groups = [before, middle, after].filter((g) => g.length > 0);
  const parts: string[] = [];
  groups.forEach((group, i) => {
    if (i > 0) {
      parts.push('');
    }
    parts.push(...group);
  });
  if (after.length === 0 && parts[parts.length - 1] !== '') {
    parts.push('');
  }
  return parts.join('\n');
}

/** The leading whitespace of a line — the indentation a rewrite keeps. */
function indentOf(line: string): string {
  return /^[ \t]*/.exec(line)?.[0] ?? '';
}

/**
 * A title or scenario name as ONE line. A newline in it would forge Gherkin
 * structure: the rest of the name would read as a description or a step, and a
 * `@status:` written there would move the feature.
 */
function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
