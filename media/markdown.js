// RepoDoc — Doc/Decision reading view.
//
// The whole view is rendered host-side; the only interaction is the top-bar
// button that flips between reading and the HEAD → working tree diff. The host
// re-renders the document and replaces this page's HTML in response.
//
// The message shape mirrors ToggleDiffMessage in src/panels/markdownPanel.ts by
// hand: this file is loaded straight into the webview with no build step, so
// nothing enforces the contract but this comment.
(function () {
  const vscode = acquireVsCodeApi();
  const toggle = document.getElementById('diff-toggle');
  if (toggle) {
    toggle.addEventListener('click', function () {
      vscode.postMessage({ type: 'toggleDiff' });
    });
  }
})();
