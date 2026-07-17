---
column: done
labels: [core]
priority: high
updatedAt: 2026-07-16T15:20:00.000Z
---
# Restructure to Ports & Adapters with file-per-card layout

Move all file and clock IO behind `FileSystemPort` / `ClockPort` so `src/core/**`
never imports `vscode` or node built-ins. Switch storage to one markdown file per
card (`boards/<id>/NN-slug.md`) plus a `.config.json`, renumbered on drag. The
Node adapter runs in production; an in-memory adapter backs the unit tests.

## Checklist

- [x] Define FileSystemPort and ClockPort interfaces
- [x] Add Node and in-memory filesystem adapters
- [x] Migrate to one-file-per-card storage layout
- [x] Point the store at the ports and drop direct vscode/fs imports
