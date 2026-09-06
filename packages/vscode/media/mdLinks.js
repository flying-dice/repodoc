/* RepoDoc reading-view link routing — plain browser ES2020, no build step.

   A relative href inside a webview resolves against a `vscode-webview://`
   origin and navigates nowhere, so every link in the rendered markdown is
   handed to the host, which resolves it against the document's repo-relative
   path (see src/panels/linkTargets.ts) and opens the right surface.

   Same-page `#fragment` links are handled here — the host is not involved. */
(function () {
  'use strict';

  var vscode = acquireVsCodeApi();

  /** GitHub-style heading slug: lowercase, punctuation dropped, spaces to dashes. */
  function slugify(text) {
    return String(text || '')
      .trim()
      .toLowerCase()
      .replace(/[^\w\- ]+/g, '')
      .replace(/\s+/g, '-');
  }

  // The renderer emits plain headings, so give each one the id its slug link
  // expects. Existing ids win.
  function idHeadings() {
    var used = {};
    var headings = document.querySelectorAll('.adr-md h1, .adr-md h2, .adr-md h3, .adr-md h4');
    for (var i = 0; i < headings.length; i++) {
      var heading = headings[i];
      if (heading.id) {
        used[heading.id] = true;
        continue;
      }
      var base = slugify(heading.textContent);
      if (!base) {
        continue;
      }
      var id = base;
      var n = 1;
      while (used[id]) {
        n++;
        id = base + '-' + n;
      }
      used[id] = true;
      heading.id = id;
    }
  }

  function decode(value) {
    try {
      return decodeURIComponent(value);
    } catch (_err) {
      return value;
    }
  }

  function scrollToFragment(fragment) {
    var name = decode(fragment);
    if (!name) {
      return;
    }
    var target = document.getElementById(name);
    if (!target) {
      var slug = slugify(name);
      var headings = document.querySelectorAll('.adr-md h1, .adr-md h2, .adr-md h3, .adr-md h4');
      for (var i = 0; i < headings.length && !target; i++) {
        if (headings[i].id === slug || slugify(headings[i].textContent) === slug) {
          target = headings[i];
        }
      }
    }
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  /** `#x`, `?q#x` and `.#x` all point within this page; anything else does not. */
  function localFragment(href) {
    var at = href.indexOf('#');
    if (at === -1) {
      return null;
    }
    var before = href.slice(0, at);
    if (before === '' || before === '.' || before.charAt(0) === '?') {
      return href.slice(at + 1);
    }
    return null;
  }

  document.addEventListener('click', function (e) {
    var anchor = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    // Only links inside the rendered document: the topbar's `command:` links
    // (Open source, the file crumb) must keep working untouched.
    if (!anchor || !anchor.closest('.adr-md')) {
      return;
    }
    var href = anchor.getAttribute('href') || '';
    if (!href) {
      return;
    }
    e.preventDefault();
    var fragment = localFragment(href);
    if (fragment !== null) {
      scrollToFragment(fragment);
      return;
    }
    vscode.postMessage({ type: 'openLink', href: href });
  });

  idHeadings();
})();
