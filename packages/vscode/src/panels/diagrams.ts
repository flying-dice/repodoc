import { MARKDOWN_OPTIONS } from '@repodoc/core/diff';
import { Marked, type Token } from 'marked';
import { encode } from 'plantuml-encoder';
import { escapeHtml } from './html';

/**
 * Markdown rendering for the reading views, with diagram support:
 *  - ```mermaid fences become `<pre class="mermaid">` blocks rendered
 *    client-side by the bundled mermaid script.
 *  - ```plantuml / ```puml fences become `<img>` tags pointing at the
 *    configured PlantUML server (deflate-encoded URL); with no server
 *    configured they fall back to a plain code block.
 *
 * Kept vscode-free so the renderer is unit-testable.
 */
export function renderMarkdownWithDiagrams(
  markdown: string,
  options: { plantUmlServer?: string },
): { html: string; hasMermaid: boolean } {
  const { marked, mermaidSeen } = createRenderer(options);
  const html = marked.parse(markdown) as string;
  return { html, hasMermaid: mermaidSeen() };
}

/**
 * The same rendering, from tokens the caller already holds.
 *
 * The diff renders *parsed* content: each run is rendered from the tokens of
 * the document it came from, so a removed block is shown as its own side read
 * it. Re-serialising those tokens to markdown and parsing them again would
 * give the document a second chance to be interpreted differently, which is
 * exactly the class of defect this path exists to remove.
 */
export function renderTokensWithDiagrams(
  tokens: Token[],
  options: { plantUmlServer?: string },
): { html: string; hasMermaid: boolean } {
  const { marked, mermaidSeen } = createRenderer(options);
  const html = marked.parser(tokens) as string;
  return { html, hasMermaid: mermaidSeen() };
}

/**
 * A parser configured exactly as the reading view's, diagram fences included.
 *
 * The options come from core so the parse the diff was computed over and the
 * parse the reader sees cannot drift apart.
 */
function createRenderer(options: { plantUmlServer?: string }): {
  marked: Marked;
  mermaidSeen: () => boolean;
} {
  let hasMermaid = false;
  const server = (options.plantUmlServer ?? '').trim().replace(/\/+$/, '');

  const marked = new Marked({
    ...MARKDOWN_OPTIONS,
    renderer: {
      code({ text, lang }: { text: string; lang?: string }): string | false {
        const language = (lang ?? '').trim().toLowerCase();
        if (language === 'mermaid') {
          hasMermaid = true;
          return `<pre class="mermaid">${escapeHtml(text)}</pre>\n`;
        }
        if ((language === 'plantuml' || language === 'puml') && server) {
          const url = `${server}/svg/${encode(text)}`;
          return `<p><img class="plantuml" src="${escapeHtml(url)}" alt="PlantUML diagram"></p>\n`;
        }
        return false; // default code rendering
      },
    },
  });

  return { marked, mermaidSeen: (): boolean => hasMermaid };
}
