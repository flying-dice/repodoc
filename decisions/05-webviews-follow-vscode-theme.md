---
status: Accepted
date: 2026-07-17
---
# Decision 05 — Webviews follow VS Code theme tokens


## Context

The board and reading views are webviews with their own CSS, disconnected from
VS Code's theming. Hard-coded colors looked wrong against half the themes users
run — a light-on-light board under a dark theme, or vice versa — and clashed with
the surrounding editor chrome.

## Decision

Webview styling is driven by VS Code's `--vscode-*` theme variables (editor
background and foreground, focus borders, button and badge colors, and so on).
The design's hex values remain only as fallbacks for when a variable is absent.

Data colors are the deliberate exception: label and agent swatches use the
literal hex from `.config.json`, because those colors carry meaning that must
stay stable regardless of the active theme.

## Consequences

- The board and reading views blend into whatever theme the user runs, light or
  dark, without per-theme overrides.
- Contributors add new UI with theme variables by default and reach for a literal
  color only when it encodes data.
- Screenshots and the demo GIF look correct only against the theme they were
  captured in, since the live UI now shifts with the user's theme.
