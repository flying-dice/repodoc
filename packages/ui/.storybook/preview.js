import { withThemeByDataAttribute } from '@storybook/addon-themes';

// The stylesheets the extension actually ships. Importing the real files — not
// a copy — is the point: a rule that stops matching, or ends up nested inside
// another rule, shows up in a story instead of in a bug report.
import '../../vscode/media/base.css';
import '../../vscode/media/board.css';
import '../../vscode/media/markdown.css';

// The `--vscode-*` variables VS Code would inject. Without these every colour
// resolves to nothing and a story proves nothing.
import '../src/theme/vscode-theme.css';

export const decorators = [
  withThemeByDataAttribute({
    themes: { dark: 'dark', light: 'light' },
    defaultTheme: 'dark',
    attributeName: 'data-theme',
  }),
  // Components render onto the editor background, as they do in the webview.
  (story) => {
    const wrap = document.createElement('div');
    wrap.style.cssText =
      'background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);' +
      'font-family:var(--font-sans);padding:24px;min-height:100vh;';
    wrap.appendChild(story());
    return wrap;
  },
];

export const parameters = {
  controls: { expanded: true },
  options: {
    storySort: { order: ['Atoms', 'Molecules', 'Organisms'] },
  },
};
