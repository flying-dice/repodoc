import * as assert from 'assert';
import { hasMarkdownChanges } from '../../core/diff';
import { renderMarkdownDiff } from '../../panels/diffView';

/**
 * Exercises the diff renderer end to end: markdown in, reading-view HTML out.
 * Runs inside the extension host because the shared renderer is reached
 * through the panels layer, but it touches no vscode API of its own.
 */

const NO_DIAGRAMS = { plantUmlServer: '' };

suite('diff.hasMarkdownChanges', () => {
  test('identical documents do not differ', () => {
    assert.strictEqual(hasMarkdownChanges('# A\n\nBody.\n', '# A\n\nBody.\n'), false);
  });

  test('reflowing a paragraph is not a difference', () => {
    assert.strictEqual(hasMarkdownChanges('one two three\n', 'one two\nthree\n'), false);
  });

  test('a changed word is a difference', () => {
    assert.strictEqual(hasMarkdownChanges('one two\n', 'one three\n'), true);
  });

  test('a new document differs from an empty baseline', () => {
    assert.strictEqual(hasMarkdownChanges('', '# New\n'), true);
  });
});

suite('diffView.renderMarkdownDiff', () => {
  test('unchanged blocks render without any marker', () => {
    const result = renderMarkdownDiff('# Same\n', '# Same\n', NO_DIAGRAMS);
    assert.ok(result.html.includes('<h1>Same</h1>'));
    assert.ok(!result.html.includes('diff-run'));
    assert.strictEqual(result.added, 0);
    assert.strictEqual(result.removed, 0);
  });

  test('a reworded bullet marks the old one removed and the new one added', () => {
    const result = renderMarkdownDiff('- old\n', '- new\n', NO_DIAGRAMS);
    assert.ok(result.html.includes('diff-del'));
    assert.ok(result.html.includes('diff-add'));
    assert.ok(result.html.indexOf('diff-del') < result.html.indexOf('diff-add'), 'old reads first');
    assert.strictEqual(result.added, 1);
    assert.strictEqual(result.removed, 1);
  });

  test('counts every block in a run, not just the runs', () => {
    const result = renderMarkdownDiff('- keep\n', '- keep\n- one\n- two\n', NO_DIAGRAMS);
    assert.strictEqual(result.added, 2);
    assert.strictEqual(result.removed, 0);
  });

  test('a run of added list items renders as one list', () => {
    const result = renderMarkdownDiff('', '- one\n- two\n', NO_DIAGRAMS);
    assert.strictEqual((result.html.match(/<ul>/g) ?? []).length, 1);
  });

  test('marked blocks are labelled for screen readers', () => {
    const result = renderMarkdownDiff('- old\n', '- new\n', NO_DIAGRAMS);
    assert.ok(result.html.includes('aria-label="removed"'));
    assert.ok(result.html.includes('aria-label="added"'));
  });

  test('mermaid fences inside a diff are still reported', () => {
    const after = '# T\n\n```mermaid\ngraph TD;\nA-->B;\n```\n';
    const result = renderMarkdownDiff('# T\n', after, NO_DIAGRAMS);
    assert.strictEqual(result.hasMermaid, true);
  });

  test('an ordered list split by a change keeps its numbering', () => {
    const before = '1. one\n2. two\n3. three\n';
    const after = '1. one\n2. changed\n3. three\n';
    const result = renderMarkdownDiff(before, after, NO_DIAGRAMS);
    // The unchanged tail must not restart at 1.
    assert.ok(result.html.includes('<ol start="3">'), result.html);
  });
});
