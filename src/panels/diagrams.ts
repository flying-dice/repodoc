import { Marked } from 'marked';
import { encode } from 'plantuml-encoder';
import { escapeHtml } from './webviewHtml';

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
  let hasMermaid = false;
  const server = (options.plantUmlServer ?? '').trim().replace(/\/+$/, '');

  const marked = new Marked({
    gfm: true,
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

  const html = marked.parse(markdown) as string;
  return { html, hasMermaid };
}
