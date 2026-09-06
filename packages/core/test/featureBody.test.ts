import { describe, test } from 'bun:test';
import * as assert from 'node:assert';
import {
  addScenario,
  removeScenario,
  setFeatureDescription,
  setFeatureTitle,
  setScenario,
} from '../src/featureBody';
import { parseFeature } from '../src/featureParse';

/**
 * The writers behind managed feature editing. A `.feature` file is user source
 * owned by the test runner, so every test here asks the same question: did the
 * edit change ONLY what it was asked to change?
 */

/**
 * One file carrying everything RepoDoc does not understand but must preserve:
 * a language comment, feature tags, a `Background:`, scenario tags, a doc
 * string, a `Rule:` with a `Scenario Outline:` and its `Examples:` table.
 */
const RICH = [
  '# language: en',
  '@status:specified @core',
  'Feature: Gates block a move',
  '',
  '  A card may not enter a column whose enter gates fail.',
  '  The refusal prints every failing gate.',
  '',
  '  Background:',
  '    Given a board with gates',
  '',
  '  @slow @wip',
  '  Scenario: The move is refused',
  '    When I move the card',
  '    Then it stays put',
  '    """',
  '    a doc string',
  '      indented inside',
  '    """',
  '',
  '  Rule: Only gated columns refuse',
  '',
  '    Scenario Outline: Each gate kind refuses',
  '      When I move with a <kind> gate',
  '      Examples:',
  '        | kind   |',
  '        | script |',
  '',
  '  Example: A satisfied gate lets the card through',
  '    Then the card moves',
  '',
].join('\n');

/** The lines of `text` that are not part of the scenario at `index`. */
function outside(text: string, index: number): string[] {
  const scenario = parseFeature('x.feature', text).scenarios[index];
  assert.ok(scenario, `scenario ${index} exists`);
  const lines = text.split('\n');
  return lines.slice(0, scenario.start).concat(lines.slice(scenario.end));
}

describe('parseFeature spans', () => {
  test('a scenario owns its tag lines, its body and the blank line below it', () => {
    const parsed = parseFeature('rich.feature', RICH);
    assert.deepStrictEqual(
      parsed.scenarios.map((s) => [s.keyword, s.name]),
      [
        ['Scenario', 'The move is refused'],
        ['Scenario Outline', 'Each gate kind refuses'],
        ['Example', 'A satisfied gate lets the card through'],
      ],
      'Background: and Rule: are not scenarios and are never indexed as one',
    );
    const [refused, outline] = parsed.scenarios;
    assert.ok(refused && outline);
    // The `@slow @wip` line above it is the scenario's; the Background above
    // that is not, and neither is the `Rule:` below.
    assert.deepStrictEqual([refused.start, refused.headingLine, refused.end], [10, 11, 19]);
    assert.deepStrictEqual(refused.steps, [
      'When I move the card',
      'Then it stays put',
      '"""',
      'a doc string',
      '  indented inside', // the doc string keeps its own relative indentation
      '"""',
    ]);
    // An outline keeps its Examples table: it is part of the scenario, not a
    // block of its own.
    assert.deepStrictEqual(outline.steps, [
      'When I move with a <kind> gate',
      'Examples:',
      '  | kind   |',
      '  | script |',
    ]);
    assert.deepStrictEqual(parsed.descriptionSpan, { start: 3, end: 7 });
    assert.strictEqual(parsed.featureLine, 2);
  });
});

describe('setFeatureTitle', () => {
  test('rewrites only the name on the Feature line', () => {
    const next = setFeatureTitle(RICH, 'Gates refuse a move');
    assert.strictEqual(
      next,
      RICH.replace('Feature: Gates block a move', 'Feature: Gates refuse a move'),
    );
  });

  test('writing the same title back is byte-identical', () => {
    assert.strictEqual(setFeatureTitle(RICH, 'Gates block a move'), RICH);
  });

  test('collapses a multi-line title so it cannot forge Gherkin', () => {
    const next = setFeatureTitle('Feature: A\n', 'B\n@status:done\nScenario: forged');
    assert.strictEqual(next, 'Feature: B @status:done Scenario: forged\n');
    assert.strictEqual(parseFeature('x.feature', next).scenarios.length, 0);
  });

  test('inserts a Feature line below the tags when the file has none', () => {
    const text = '@status:proposed\n\n  Scenario: Orphan\n    Given a thing\n';
    const next = setFeatureTitle(text, 'Now titled');
    assert.strictEqual(
      next,
      '@status:proposed\n\nFeature: Now titled\n  Scenario: Orphan\n    Given a thing\n',
    );
    const parsed = parseFeature('x.feature', next);
    assert.strictEqual(parsed.title, 'Now titled');
    assert.deepStrictEqual(parsed.tags, ['@status:proposed'], 'the tags stay the feature’s');
    assert.strictEqual(parsed.scenarios.length, 1, 'the orphan scenario survives');
  });

  test('a file with only tags gets its Feature line before the trailing newline', () => {
    assert.strictEqual(
      setFeatureTitle('@status:proposed\n', 'Fresh'),
      '@status:proposed\nFeature: Fresh\n',
    );
  });
});

describe('setFeatureDescription', () => {
  test('replaces the description and nothing else', () => {
    const next = setFeatureDescription(RICH, 'One line now.');
    assert.strictEqual(
      next,
      RICH.replace(
        '  A card may not enter a column whose enter gates fail.\n  The refusal prints every failing gate.',
        '  One line now.',
      ),
    );
    assert.strictEqual(parseFeature('x.feature', next).description, 'One line now.');
  });

  test('writing the parsed description back is byte-identical', () => {
    const parsed = parseFeature('rich.feature', RICH);
    assert.strictEqual(setFeatureDescription(RICH, parsed.description), RICH);
  });

  test('an empty description is removed, leaving one blank line', () => {
    const next = setFeatureDescription(RICH, '');
    assert.strictEqual(
      next,
      RICH.replace(
        '\n\n  A card may not enter a column whose enter gates fail.\n  The refusal prints every failing gate.\n',
        '\n',
      ),
    );
    assert.strictEqual(parseFeature('x.feature', next).description, '');
    assert.ok(next.includes('  Background:'), 'the Background is still there');
  });

  test('adds a description to a feature that has none', () => {
    const text = '@status:proposed\nFeature: Bare\n\n  Scenario: S\n';
    assert.strictEqual(
      setFeatureDescription(text, 'Now it says something.'),
      '@status:proposed\nFeature: Bare\n\n  Now it says something.\n\n  Scenario: S\n',
    );
  });

  test('keeps a comment written inside the description', () => {
    // The UI never shows the comment (the parser skips it), so a save must not
    // be able to delete it.
    const text = 'Feature: X\n  # keep me\n  Old prose.\n\n  Scenario: S\n';
    const next = setFeatureDescription(text, 'New prose.');
    assert.strictEqual(next, 'Feature: X\n\n  # keep me\n  New prose.\n\n  Scenario: S\n');
    assert.strictEqual(
      setFeatureDescription(next, ''),
      'Feature: X\n\n  # keep me\n\n  Scenario: S\n',
    );
  });

  test('a file with no Feature line is returned untouched', () => {
    const text = '@status:proposed\nScenario: Orphan\n';
    assert.strictEqual(setFeatureDescription(text, 'nowhere to put this'), text);
  });
});

describe('setScenario', () => {
  test('writing a scenario back unchanged is byte-identical', () => {
    const parsed = parseFeature('rich.feature', RICH);
    for (const [index, scenario] of parsed.scenarios.entries()) {
      assert.strictEqual(
        setScenario(RICH, index, { name: scenario.name, steps: scenario.steps }),
        RICH,
        `scenario ${index} round-trips`,
      );
    }
  });

  test('renames a scenario keeping its keyword, tags and indentation', () => {
    const next = setScenario(RICH, 0, { name: 'The move is refused loudly' });
    assert.ok(next);
    assert.strictEqual(
      next,
      RICH.replace('Scenario: The move is refused', 'Scenario: The move is refused loudly'),
    );
    assert.ok(next.includes('  @slow @wip\n'), 'the scenario keeps its tags');
  });

  test('rewrites a body without touching the Rule, Background or siblings', () => {
    const next = setScenario(RICH, 1, { steps: ['Given nothing', 'Then nothing'] });
    assert.ok(next);
    assert.deepStrictEqual(
      outside(next, 1),
      outside(RICH, 1),
      'every line outside the block is untouched',
    );
    assert.ok(next.includes('  Rule: Only gated columns refuse'));
    assert.ok(next.includes('  Background:\n    Given a board with gates'));
    assert.ok(next.includes('    """\n    a doc string\n      indented inside\n    """'));
    assert.ok(
      next.includes(
        '    Scenario Outline: Each gate kind refuses\n      Given nothing\n      Then nothing\n',
      ),
      `the body is rewritten at the block's own indentation, saw:\n${next}`,
    );
    assert.ok(!next.includes('| script |'), 'the replaced Examples table is gone');
  });

  test('a step carrying newlines becomes one line each, never a forged one-liner', () => {
    const next = setScenario('Feature: F\n\n  Scenario: S\n    Given a\n', 0, {
      steps: ['Given a\nThen b'],
    });
    assert.strictEqual(next, 'Feature: F\n\n  Scenario: S\n    Given a\n    Then b\n');
  });

  test('an empty body leaves the heading and the blank line below it', () => {
    const next = setScenario('Feature: F\n\n  Scenario: S\n    Given a\n\n  Scenario: T\n', 0, {
      steps: [],
    });
    assert.strictEqual(next, 'Feature: F\n\n  Scenario: S\n\n  Scenario: T\n');
  });

  test('an out-of-range index writes nothing', () => {
    for (const index of [3, -1, 99]) {
      assert.strictEqual(setScenario(RICH, index, { name: 'nope' }), undefined);
    }
  });
});

describe('addScenario', () => {
  test('appends at the end, at the indentation the file already uses', () => {
    const next = addScenario(RICH, { name: 'A new one', steps: ['Given a', 'Then b'] });
    assert.ok(next.startsWith(RICH.trimEnd()), 'the whole file is preserved above it');
    assert.strictEqual(
      next,
      `${RICH.trimEnd()}\n\n  Scenario: A new one\n    Given a\n    Then b\n`,
    );
    const parsed = parseFeature('x.feature', next);
    assert.strictEqual(parsed.scenarios.length, 4);
    assert.deepStrictEqual(parsed.scenarios[3]?.steps, ['Given a', 'Then b']);
  });

  test('an explicit keyword is written as given', () => {
    const next = addScenario('Feature: F\n', { name: 'Table driven', keyword: 'Scenario Outline' });
    assert.strictEqual(next, 'Feature: F\n\n  Scenario Outline: Table driven\n');
  });

  test('the first scenario of a bare feature lands two spaces in', () => {
    assert.strictEqual(
      addScenario('Feature: F\n', { name: 'First', steps: ['Given a'] }),
      'Feature: F\n\n  Scenario: First\n    Given a\n',
    );
  });
});

describe('removeScenario', () => {
  test('takes the scenario, its tags and one separator, and nothing else', () => {
    const next = removeScenario(RICH, 0);
    assert.ok(next);
    assert.strictEqual(next, outside(RICH, 0).join('\n'));
    assert.ok(!next.includes('@slow @wip'), 'the scenario’s own tags go with it');
    assert.ok(next.includes('@status:specified @core'), 'the feature’s tags stay');
    assert.ok(next.includes('  Background:'), 'the Background stays');
    assert.ok(next.includes('  Rule: Only gated columns refuse'));
    assert.strictEqual(parseFeature('x.feature', next).scenarios.length, 2);
    assert.ok(!next.includes('\n\n\n'), 'no blank-line run is left behind');
  });

  test('removing the last scenario leaves one trailing newline', () => {
    const next = removeScenario(RICH, 2);
    assert.ok(next);
    assert.ok(
      next.endsWith('        | script |\n'),
      `saw the tail: ${JSON.stringify(next.slice(-40))}`,
    );
    assert.strictEqual(parseFeature('x.feature', next).scenarios.length, 2);
  });

  test('an out-of-range index writes nothing', () => {
    assert.strictEqual(removeScenario(RICH, 3), undefined);
    assert.strictEqual(removeScenario(RICH, -1), undefined);
  });
});

describe('line endings and fixed points', () => {
  test('a CRLF file stays CRLF through every writer', () => {
    const crlf = RICH.replace(/\n/g, '\r\n');
    const edits = [
      setFeatureTitle(crlf, 'Retitled'),
      setFeatureDescription(crlf, 'Rewritten.'),
      setScenario(crlf, 0, { name: 'Renamed', steps: ['Given a'] }),
      addScenario(crlf, { name: 'Added', steps: ['Given a'] }),
      removeScenario(crlf, 0),
    ];
    for (const [i, edit] of edits.entries()) {
      assert.ok(edit !== undefined, `edit ${i} was written`);
      assert.ok(!/[^\r]\n/.test(edit), `edit ${i} kept CRLF endings`);
      assert.strictEqual(edit.replace(/\r\n/g, '\n').includes('\r'), false, 'no stray CR');
    }
    // The same edit on the LF file, re-ended, is the same bytes.
    assert.strictEqual(
      setFeatureTitle(crlf, 'Retitled'),
      setFeatureTitle(RICH, 'Retitled').replace(/\n/g, '\r\n'),
    );
  });

  test('edit → parse → edit is a fixed point', () => {
    const once = setScenario(
      setFeatureDescription(setFeatureTitle(RICH, 'Renamed feature'), 'Fresh prose.'),
      1,
      { name: 'Renamed scenario', steps: ['Given a', 'Then b'] },
    );
    assert.ok(once);
    const parsed = parseFeature('x.feature', once);
    const scenario = parsed.scenarios[1];
    assert.ok(scenario);
    const twice = setScenario(
      setFeatureDescription(setFeatureTitle(once, parsed.title), parsed.description),
      1,
      { name: scenario.name, steps: scenario.steps },
    );
    assert.strictEqual(twice, once, 'writing back what was read changes nothing');
  });

  test('a file with tabs keeps its tabs', () => {
    const tabbed = 'Feature: T\n\n\tScenario: S\n\t\tGiven a\n';
    const parsed = parseFeature('t.feature', tabbed);
    assert.deepStrictEqual(parsed.scenarios[0]?.steps, ['Given a']);
    assert.strictEqual(setScenario(tabbed, 0, { name: 'S', steps: ['Given a'] }), tabbed);
  });
});

/**
 * A doc string is payload, so it is part of the body a writer replaces or
 * removes — whole, never half. Half a doc string left in a file changes what
 * the runner feeds the step and can forge structure out of the leftover.
 */
describe('writers and doc strings', () => {
  const PAYLOAD = [
    'Feature: Payload',
    '',
    '  Scenario: Send a document',
    '    Given a document',
    '      """',
    '      Scenario: this is payload text',
    '      """',
    '    Then it is accepted',
    '',
    '  Scenario: Second',
    '    Then it is done',
    '',
  ].join('\n');

  test('writing the steps back unchanged is byte-identical', () => {
    const scenario = parseFeature('x.feature', PAYLOAD).scenarios[0];
    assert.ok(scenario);
    assert.strictEqual(setScenario(PAYLOAD, 0, { steps: scenario.steps }), PAYLOAD);
  });

  test('replacing the steps removes the whole doc string and nothing else', () => {
    const next = setScenario(PAYLOAD, 0, { steps: ['Given a document', 'Then it is accepted'] });
    assert.strictEqual(
      next,
      [
        'Feature: Payload',
        '',
        '  Scenario: Send a document',
        '    Given a document',
        '    Then it is accepted',
        '',
        '  Scenario: Second',
        '    Then it is done',
        '',
      ].join('\n'),
    );
  });

  test('renaming the scenario leaves the doc string alone', () => {
    const next = setScenario(PAYLOAD, 0, { name: 'Renamed' });
    assert.strictEqual(next, PAYLOAD.replace('Scenario: Send a document', 'Scenario: Renamed'));
  });

  test('removing the scenario takes the doc string with it', () => {
    const next = removeScenario(PAYLOAD, 0);
    assert.strictEqual(
      next,
      ['Feature: Payload', '', '  Scenario: Second', '    Then it is done', ''].join('\n'),
    );
    assert.ok(!next?.includes('"""'), 'no delimiter is left behind');
  });

  test('an unterminated doc string is replaced whole, or removed whole', () => {
    const truncated = [
      'Feature: Payload',
      '',
      '  Scenario: First',
      '    Then it is done',
      '',
      '  Scenario: Truncated',
      '    Given a document',
      '      """',
      '      Scenario: never closed',
      '',
    ].join('\n');
    assert.strictEqual(
      setScenario(truncated, 1, { steps: ['Given a document'] }),
      [
        'Feature: Payload',
        '',
        '  Scenario: First',
        '    Then it is done',
        '',
        '  Scenario: Truncated',
        '    Given a document',
        '',
      ].join('\n'),
    );
    assert.strictEqual(
      removeScenario(truncated, 1),
      ['Feature: Payload', '', '  Scenario: First', '    Then it is done', ''].join('\n'),
    );
  });

  test('a scenario appended after a doc-string block sits below it, at feature indentation', () => {
    const next = addScenario(PAYLOAD, { name: 'Third', steps: ['Given y'] });
    assert.strictEqual(next, `${PAYLOAD.trimEnd()}\n\n  Scenario: Third\n    Given y\n`);
    const parsed = parseFeature('x.feature', next);
    assert.deepStrictEqual(
      parsed.scenarios.map((s) => s.name),
      ['Send a document', 'Second', 'Third'],
    );
  });

  test('a backtick doc string is body too', () => {
    const fenced = [
      'Feature: Payload',
      '',
      '  Scenario: Fenced',
      '    Given a document',
      '      ```json',
      '      {"Scenario: x": 1}',
      '      ```',
      '',
    ].join('\n');
    const scenario = parseFeature('x.feature', fenced).scenarios[0];
    assert.ok(scenario);
    assert.strictEqual(setScenario(fenced, 0, { steps: scenario.steps }), fenced);
    assert.strictEqual(removeScenario(fenced, 0), 'Feature: Payload\n');
  });
});

describe('addScenario after a Rule block', () => {
  test('a new scenario takes the feature-level indentation, not the Rule-nested one', () => {
    const src = [
      'Feature: F',
      '',
      '  Scenario: First',
      '    Given x',
      '',
      '  Rule: R',
      '',
      '    Scenario Outline: Nested',
      '      Given a <k>',
      '      Examples:',
      '        | k |',
      '        | 1 |',
      '',
    ].join('\n');
    const out = addScenario(src, { name: 'Third', steps: ['Given y', 'Then z'] });
    assert.strictEqual(out, `${src.trimEnd()}\n\n  Scenario: Third\n    Given y\n    Then z\n`);
  });
});
