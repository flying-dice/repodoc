---
column: done
labels: [webview, docs]
priority: med
updatedAt: 2026-07-16T13:05:00.000Z
---
# Decision & docs rendered reading views

Render decision records and docs pages as themed reading views. Decisions parse
their `**Status:**` line for the lifecycle badge; docs build a Docusaurus-style
sidebar tree from `docs/**`, ordered by numeric prefixes. Both reuse the shared
markdown-to-HTML panel (marked) so links and headings render consistently.
