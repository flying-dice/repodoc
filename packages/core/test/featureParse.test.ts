import { describe, test } from 'bun:test';
import * as assert from 'node:assert';
import { parseFeature, statusFromTags, tagsWithoutStatus } from '../src/featureParse';

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
