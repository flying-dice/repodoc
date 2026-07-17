---
column: done
labels: [testing]
priority: high
updatedAt: 2026-07-16T17:45:00.000Z
---
# Unit and end-to-end test suites

Cover the vscode-free core with unit tests running against the in-memory
filesystem adapter, and drive the real extension host with an e2e suite. The
watcher e2e test was hardened for CI, which does not always deliver filesystem
events on Linux.

## Checklist

- [x] Unit tests for frontmatter, naming, ordering, and board config
- [x] Store unit tests (boards, cards, decisions, docs, events, moveCard)
- [x] End-to-end suite driving the activated extension
- [x] Stabilise the flaky file-watcher e2e test for CI
