---
column: todo
labels: [webview]
priority: med
updatedAt: 2026-07-17T12:10:00.000Z
---
# Create and edit cards from the tree view

The store can already add cards; expose it from the Boards tree so contributors
can create a card, retitle it, and move it between columns without opening the
board panel or editing the markdown by hand. Reuse the existing `addCard` and
`moveCard` store methods behind new tree context-menu actions.
