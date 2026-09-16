// RepoDoc — Doc/Decision reading view.
//
// The whole view is rendered host-side; the only interaction is the top-bar
// button that flips between reading and the HEAD → working tree diff. The host
// re-renders the document and replaces this page's HTML in response.
(function () {
  const vscode = acquireVsCodeApi();
  const toggle = document.getElementById('diff-toggle');
  if (toggle) {
    toggle.addEventListener('click', function () {
      vscode.postMessage({ type: 'toggleDiff' });
    });
  }
})();
