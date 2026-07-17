import * as assert from 'assert';
import { renderMarkdownWithDiagrams } from '../../panels/diagrams';
import { sanitizeReadingWidth } from '../../panels/readingWidth';

suite('renderMarkdownWithDiagrams', () => {
  test('mermaid fences become pre.mermaid blocks and set hasMermaid', () => {
    const { html, hasMermaid } = renderMarkdownWithDiagrams(
      '# T\n\n```mermaid\ngraph TD; A-->B;\n```\n',
      {},
    );
    assert.ok(hasMermaid);
    assert.ok(html.includes('<pre class="mermaid">graph TD; A--&gt;B;</pre>'));
  });

  test('plantuml fences render as images against the configured server', () => {
    const { html, hasMermaid } = renderMarkdownWithDiagrams(
      '```plantuml\nA -> B: hi\n```\n',
      { plantUmlServer: 'https://uml.example.com/plantuml/' },
    );
    assert.ok(!hasMermaid);
    assert.ok(/<img class="plantuml" src="https:\/\/uml\.example\.com\/plantuml\/svg\/[A-Za-z0-9\-_]+"/.test(html));
  });

  test('puml alias works; no server -> plain code block', () => {
    const withServer = renderMarkdownWithDiagrams('```puml\nA -> B\n```\n', {
      plantUmlServer: 'https://x.test',
    });
    assert.ok(withServer.html.includes('img class="plantuml"'));
    const without = renderMarkdownWithDiagrams('```plantuml\nA -> B\n```\n', {});
    assert.ok(without.html.includes('<pre><code'));
    assert.ok(!without.html.includes('plantuml" src'));
  });

  test('ordinary code fences are untouched', () => {
    const { html, hasMermaid } = renderMarkdownWithDiagrams('```ts\nconst a = 1;\n```\n', {});
    assert.ok(!hasMermaid);
    assert.ok(html.includes('<pre><code'));
  });
});


suite('GitHub Flavored Markdown support', () => {
  test('tables render', () => {
    const { html } = renderMarkdownWithDiagrams('| a | b |\n| - | - |\n| 1 | 2 |\n', {});
    assert.ok(html.includes('<table>'));
    assert.ok(html.includes('<td>1</td>'));
  });

  test('strikethrough renders', () => {
    const { html } = renderMarkdownWithDiagrams('~~gone~~\n', {});
    assert.ok(html.includes('<del>gone</del>'));
  });

  test('task lists render as checkboxes', () => {
    const { html } = renderMarkdownWithDiagrams('- [x] done\n- [ ] open\n', {});
    assert.ok(html.includes('type="checkbox"'));
    assert.ok(html.includes('checked'));
  });

  test('autolinks render', () => {
    const { html } = renderMarkdownWithDiagrams('visit https://example.com now\n', {});
    assert.ok(html.includes('<a href="https://example.com"'));
  });
});

suite('sanitizeReadingWidth', () => {
  test('presets pass through; legacy normal maps to narrow', () => {
    assert.strictEqual(sanitizeReadingWidth('narrow'), 'narrow');
    assert.strictEqual(sanitizeReadingWidth('WIDE'), 'wide');
    assert.strictEqual(sanitizeReadingWidth('full'), 'full');
    assert.strictEqual(sanitizeReadingWidth('normal'), 'narrow');
  });

  test('CSS lengths are accepted; bare numbers become px', () => {
    assert.strictEqual(sanitizeReadingWidth('500px'), '500px');
    assert.strictEqual(sanitizeReadingWidth('90%'), '90%');
    assert.strictEqual(sanitizeReadingWidth('60rem'), '60rem');
    assert.strictEqual(sanitizeReadingWidth('500'), '500px');
  });

  test('anything unsafe or unknown falls back to wide', () => {
    assert.strictEqual(sanitizeReadingWidth(undefined), 'wide');
    assert.strictEqual(sanitizeReadingWidth(''), 'wide');
    assert.strictEqual(sanitizeReadingWidth('red; background: url(x)'), 'wide');
    assert.strictEqual(sanitizeReadingWidth('calc(100% - 10px)'), 'wide');
    assert.strictEqual(sanitizeReadingWidth('50vh'), 'wide');
  });
});
