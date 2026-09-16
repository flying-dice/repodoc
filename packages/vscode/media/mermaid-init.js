/* Initializes the bundled mermaid renderer for the reading views, following
   the active VS Code theme. Loaded only when the page contains a diagram. */
(function () {
  'use strict';
  if (typeof mermaid === 'undefined') {
    return;
  }
  var kind = document.body.dataset.vscodeThemeKind || '';
  var dark = kind.indexOf('dark') !== -1 || kind === 'vscode-high-contrast';
  mermaid.initialize({
    startOnLoad: true,
    securityLevel: 'strict',
    theme: dark ? 'dark' : 'default',
  });
})();
