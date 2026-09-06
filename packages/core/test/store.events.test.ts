import { describe, test } from 'bun:test';
import * as assert from 'node:assert';
import { makeStore } from './helpers';

function boardSeed(): Record<string, string> {
  return {
    'boards/b/.config.json': JSON.stringify({
      name: 'B',
      columns: [
        { id: 'todo', name: 'todo', color: '#000' },
        { id: 'done', name: 'done', color: '#000' },
      ],
      labels: {},
      agents: {},
    }),
    'boards/b/01-c1.md': '---\ncolumn: todo\n---\n# C1\n\n## Checklist\n\n- [ ] one\n',
  };
}

describe('store.onDidChange', () => {
  test('fires exactly once per mutation', () => {
    const { store } = makeStore(boardSeed());
    let count = 0;
    store.onDidChange(() => {
      count++;
    });

    store.addCard('b', 'todo', 'New');
    assert.strictEqual(count, 1);

    store.moveCard('b', 'c1', 'done', 0);
    assert.strictEqual(count, 2);

    store.toggleChecklistItem('b', 'c1', 0);
    assert.strictEqual(count, 3);

    store.createDecision('A decision');
    assert.strictEqual(count, 4);
  });

  test('does not fire on a no-op mutation', () => {
    const { store } = makeStore(boardSeed());
    let count = 0;
    store.onDidChange(() => {
      count++;
    });
    store.moveCard('b', 'ghost', 'todo', 0); // unknown card
    store.addCard('b', 'nope', 'X'); // unknown column
    store.toggleChecklistItem('b', 'c1', 99); // out of range
    assert.strictEqual(count, 0);
  });

  test('notifies all registered listeners', () => {
    const { store } = makeStore(boardSeed());
    let a = 0;
    let b = 0;
    store.onDidChange(() => {
      a++;
    });
    store.onDidChange(() => {
      b++;
    });
    store.addColumn('b', 'Extra');
    assert.strictEqual(a, 1);
    assert.strictEqual(b, 1);
  });

  test('disposing a subscription stops it receiving events', () => {
    const { store } = makeStore(boardSeed());
    let count = 0;
    const sub = store.onDidChange(() => {
      count++;
    });
    store.addColumn('b', 'One');
    assert.strictEqual(count, 1);
    sub.dispose();
    store.addColumn('b', 'Two');
    assert.strictEqual(count, 1, 'no further events after dispose');
  });

  test('notifyExternalChange re-fires listeners', () => {
    const { store } = makeStore(boardSeed());
    let count = 0;
    store.onDidChange(() => {
      count++;
    });
    store.notifyExternalChange();
    store.notifyExternalChange();
    assert.strictEqual(count, 2);
  });
});
