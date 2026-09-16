import { describe, test } from 'bun:test';
import * as assert from 'node:assert';
import { parseFeature, statusFromTags, tagsWithoutStatus } from '../src/featureParse';
import { required } from './helpers';

describe('parseFeature', () => {
  test('reads the title, description, feature tags and scenarios', () => {
    const parsed = parseFeature(
      'gates.feature',
      [
        '@status:specified @core',
        'Feature: Gates block a move',
        '',
        '  A card may not enter a column whose enter gates fail.',
        '  The refusal prints every failing gate.',
        '',
        '  Background:',
        '    Given a board with gates',
        '',
        '  @slow',
        '  Scenario: The move is refused',
        '    When I move the card',
        '    Then it stays put',
        '',
        '  Scenario Outline: Each gate kind refuses',
        '    Examples:',
        '      | kind |',
        '      | script |',
        '',
        '  Example: A satisfied gate lets the card through',
        '',
      ].join('\n'),
    );
    assert.strictEqual(parsed.title, 'Gates block a move');
    assert.deepStrictEqual(parsed.tags, ['@status:specified', '@core']);
    assert.strictEqual(
      parsed.description,
      'A card may not enter a column whose enter gates fail.\nThe refusal prints every failing gate.',
    );
    assert.deepStrictEqual(
      parsed.scenarios.map((s) => [s.name, s.tags]),
      [
        ['The move is refused', ['@slow']],
        ['Each gate kind refuses', []],
        ['A satisfied gate lets the card through', []],
      ],
    );
  });

  test('tolerates comments, blank lines and a tag line ending the description', () => {
    const parsed = parseFeature(
      'x.feature',
      [
        '# language: en',
        '',
        '  @status:proposed',
        '',
        'Feature: Commented',
        '  # a comment inside the description',
        '  The description.',
        '',
        '@wip',
        'Scenario: One',
        '',
      ].join('\n'),
    );
    assert.strictEqual(parsed.title, 'Commented');
    assert.deepStrictEqual(parsed.tags, ['@status:proposed']);
    assert.strictEqual(parsed.description, 'The description.');
    assert.deepStrictEqual(parsed.scenarios, [
      {
        name: 'One',
        tags: ['@wip'],
        keyword: 'Scenario',
        headingLine: 9,
        // The tag line above it is part of its span; the description above that is not.
        start: 8,
        end: 11,
        steps: [],
      },
    ]);
    assert.deepStrictEqual(parsed.descriptionSpan, { start: 5, end: 8 });
    assert.strictEqual(parsed.featureLine, 4);
  });

  test('a file with no Feature line still parses, titled after the file', () => {
    const parsed = parseFeature('no-feature-line.feature', 'Scenario: Orphan\n');
    assert.strictEqual(parsed.title, 'no-feature-line');
    assert.deepStrictEqual(parsed.tags, []);
    assert.strictEqual(parsed.description, '');
    assert.deepStrictEqual(parsed.scenarios, [
      {
        name: 'Orphan',
        tags: [],
        keyword: 'Scenario',
        headingLine: 0,
        start: 0,
        end: 2,
        steps: [],
      },
    ]);
    assert.strictEqual(parsed.featureLine, undefined, 'there is no Feature: line');
  });

  test('an empty file yields the file name and nothing else', () => {
    const parsed = parseFeature('empty.feature', '');
    assert.deepStrictEqual(parsed, {
      title: 'empty',
      description: '',
      descriptionSpan: { start: 0, end: 0 },
      featureLine: undefined,
      tags: [],
      scenarios: [],
    });
  });
});

/**
 * A doc string is payload the test runner hands to a step. Everything in one
 * reads as text, whatever it looks like — this is where a parser that scans
 * lines without state invents scenarios out of a JSON fixture.
 */
describe('parseFeature and doc strings', () => {
  test('a Scenario: line inside a doc string is payload, not a second scenario', () => {
    const parsed = parseFeature(
      'payload.feature',
      [
        'Feature: Payload',
        '',
        '  The feature description.',
        '',
        '  Scenario: Send a document',
        '    Given a document',
        '      """',
        '      Scenario: this is payload text',
        '      """',
        '    Then it is accepted',
        '',
      ].join('\n'),
    );
    assert.strictEqual(parsed.scenarios.length, 1);
    const scenario = required(parsed.scenarios[0], 'scenario');
    assert.strictEqual(scenario.name, 'Send a document');
    assert.deepStrictEqual(scenario.steps, [
      'Given a document',
      '  """',
      '  Scenario: this is payload text',
      '  """',
      'Then it is accepted',
    ]);
    assert.strictEqual(parsed.description, 'The feature description.');
    assert.deepStrictEqual(parsed.descriptionSpan, { start: 1, end: 4 });
  });

  test('tags, comments, Feature:, Rule: and Examples: inside a doc string are payload', () => {
    const parsed = parseFeature(
      'payload.feature',
      [
        '@status:doing',
        'Feature: Payload',
        '',
        '  Scenario: Send a document',
        '    Given a document',
        '      """',
        '      @status:done',
        '      # not a comment',
        '      Feature: not a feature',
        '      Rule: not a rule',
        '      Examples:',
        '      | Scenario: x |',
        '      """',
        '    Then it is accepted',
        '',
      ].join('\n'),
    );
    assert.strictEqual(parsed.title, 'Payload');
    assert.deepStrictEqual(parsed.tags, ['@status:doing']);
    assert.strictEqual(parsed.scenarios.length, 1);
    const scenario = required(parsed.scenarios[0], 'scenario');
    assert.deepStrictEqual(scenario.tags, [], 'a tag in payload is not the scenario’s');
    assert.deepStrictEqual([scenario.start, scenario.headingLine, scenario.end], [3, 3, 15]);
    assert.strictEqual(scenario.steps.length, 10, 'the whole doc string is carried');
  });

  test('a backtick doc string, a media type and an indented delimiter all hold', () => {
    const parsed = parseFeature(
      'payload.feature',
      [
        'Feature: Payload',
        '',
        '  Scenario: Fenced',
        '    Given a document',
        '        ```json',
        '        {"Scenario: x": 1}',
        '        """',
        '    ```',
        '    Then it is accepted',
        '',
        '  Scenario: Quoted',
        '    Given a document',
        '      """markdown',
        '      ```',
        '      Scenario: still payload',
        '      """',
        '',
      ].join('\n'),
    );
    assert.deepStrictEqual(
      parsed.scenarios.map((s) => s.name),
      ['Fenced', 'Quoted'],
      'the other delimiter is plain content while a doc string is open',
    );
    const [fenced, quoted] = parsed.scenarios;
    assert.ok(fenced && quoted);
    assert.deepStrictEqual(fenced.steps, [
      'Given a document',
      '    ```json',
      '    {"Scenario: x": 1}',
      '    """',
      '```',
      'Then it is accepted',
    ]);
    assert.deepStrictEqual(quoted.steps, [
      'Given a document',
      '  """markdown',
      '  ```',
      '  Scenario: still payload',
      '  """',
    ]);
  });

  test('an unterminated doc string runs to the end of the file as content', () => {
    const parsed = parseFeature(
      'payload.feature',
      [
        'Feature: Payload',
        '',
        '  Scenario: Truncated',
        '    Given a document',
        '      """',
        '      Scenario: never closed',
        '',
        '  Scenario: not a scenario either',
        '',
      ].join('\n'),
    );
    assert.strictEqual(parsed.scenarios.length, 1);
    const scenario = required(parsed.scenarios[0], 'scenario');
    assert.strictEqual(scenario.name, 'Truncated');
    assert.strictEqual(scenario.end, 9, 'the block reaches the end of the file');
    // Dedented by the body's COMMON indent, which the payload lines share; the
    // trailing blank line is inside the doc string, so it is kept as content.
    assert.deepStrictEqual(scenario.steps, [
      '  Given a document',
      '    """',
      '    Scenario: never closed',
      '',
      'Scenario: not a scenario either',
      '',
    ]);
  });

  test('a Scenario: cell in a data table is a cell', () => {
    const parsed = parseFeature(
      'table.feature',
      [
        'Feature: Tables',
        '',
        '  Scenario Outline: Rows',
        '    Examples:',
        '      | name         |',
        '      | Scenario: x  |',
        '',
      ].join('\n'),
    );
    assert.strictEqual(parsed.scenarios.length, 1);
  });
});

describe('status tags', () => {
  test('statusFromTags reads the column id; a bare @status: is no status', () => {
    assert.strictEqual(statusFromTags(['@core', '@status:doing']), 'doing');
    assert.strictEqual(statusFromTags(['@core']), undefined);
    assert.strictEqual(statusFromTags(['@status:']), undefined);
  });

  test('tagsWithoutStatus drops only the status tag', () => {
    assert.deepStrictEqual(tagsWithoutStatus(['@status:done', '@core', '@ui']), ['@core', '@ui']);
  });
});
