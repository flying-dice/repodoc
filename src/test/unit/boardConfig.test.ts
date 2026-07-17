import * as assert from 'assert';
import { normalizeBoardConfig, RESERVED_CARD_KEYS } from '../../core/boardConfig';

suite('boardConfig.normalizeBoardConfig — fallbacks', () => {
  test('undefined input yields a board named from the id with empty maps', () => {
    assert.deepStrictEqual(normalizeBoardConfig(undefined, 'my-board'), {
      name: 'My Board',
      columns: [],
      labels: {},
      fields: [],
    });
  });

  test('non-object input (string/number/array) falls back', () => {
    for (const bad of ['nope', 42, ['a']] as unknown[]) {
      assert.deepStrictEqual(normalizeBoardConfig(bad, 'b'), {
        name: 'B',
        columns: [],
        labels: {},
        fields: [],
      });
    }
  });

  test('blank/absent name falls back to the title-cased id', () => {
    assert.strictEqual(normalizeBoardConfig({ name: '   ' }, 'project-x').name, 'Project X');
    assert.strictEqual(normalizeBoardConfig({}, 'project-x').name, 'Project X');
  });
});

suite('boardConfig.normalizeBoardConfig — columns', () => {
  test('keeps only entries with a non-empty string id', () => {
    const config = normalizeBoardConfig(
      {
        name: 'B',
        columns: [
          { id: 'todo', name: 'To Do', color: '#000' },
          { id: '', name: 'Bad' },
          null,
          'garbage',
          { name: 'No id' },
        ],
      },
      'b',
    );
    assert.deepStrictEqual(
      config.columns.map((c) => c.id),
      ['todo'],
    );
  });
});

suite('boardConfig.normalizeBoardConfig — label hygiene', () => {
  test('an agents map in config is ignored (no roster concept)', () => {
    const config = normalizeBoardConfig(
      { name: 'B', agents: { claude: { name: 'Claude' } } },
      'b',
    );
    assert.ok(!('agents' in config));
  });

  test('drops non-object and empty-shell entries from labels', () => {
    const config = normalizeBoardConfig(
      {
        name: 'B',
        labels: {
          bug: { name: 'bug', color: '#e5534b' },
          broken: 'not-an-object',
          arr: ['a', 'b'],
          empty: {},
          nostrings: { count: 3 },
        },
      },
      'b',
    );
    assert.deepStrictEqual(Object.keys(config.labels), ['bug']);
  });

  test('a whole non-object labels value degrades to {}', () => {
    const config = normalizeBoardConfig({ name: 'B', labels: 'x' }, 'b');
    assert.deepStrictEqual(config.labels, {});
  });
});

suite('boardConfig.normalizeBoardConfig — custom fields', () => {
  test('missing/absent fields degrades to an empty array', () => {
    assert.deepStrictEqual(normalizeBoardConfig({ name: 'B' }, 'b').fields, []);
    assert.deepStrictEqual(normalizeBoardConfig({ name: 'B', fields: 'x' }, 'b').fields, []);
  });

  test('drops non-objects, no-string-id, reserved, duplicate, and unknown-type entries', () => {
    const config = normalizeBoardConfig(
      {
        name: 'B',
        fields: [
          { id: 'estimate', type: 'number', label: 'Estimate' },
          { id: 'priority', type: 'text' }, // reserved key — dropped
          { id: 'estimate', type: 'text' }, // duplicate id — dropped
          { id: 'foo', type: 'bogus' }, // unknown type — dropped
          { id: '', type: 'text' }, // empty id — dropped
          { type: 'text' }, // no id — dropped
          null,
          'nope',
          { id: 'flag', type: 'boolean', showOnCard: true },
        ],
      },
      'b',
    );
    assert.deepStrictEqual(config.fields, [
      { id: 'estimate', type: 'number', label: 'Estimate' },
      { id: 'flag', type: 'boolean', showOnCard: true },
    ]);
  });

  test('select/multiselect always carry a coerced options string array', () => {
    const config = normalizeBoardConfig(
      {
        name: 'B',
        fields: [
          { id: 'sev', type: 'select', options: ['low', 2, 'high', null] },
          { id: 'tags', type: 'multiselect' },
        ],
      },
      'b',
    );
    assert.deepStrictEqual(config.fields, [
      { id: 'sev', type: 'select', options: ['low', 'high'] },
      { id: 'tags', type: 'multiselect', options: [] },
    ]);
  });

  test('every reserved card key is rejected as a field id', () => {
    const fields = [...RESERVED_CARD_KEYS].map((id) => ({ id, type: 'text' }));
    assert.deepStrictEqual(normalizeBoardConfig({ name: 'B', fields }, 'b').fields, []);
  });
});

suite('boardConfig.normalizeBoardConfig — column gates', () => {
  test('keeps only {id, label?, script?, field?, check?} and strips unknown props', () => {
    const config = normalizeBoardConfig(
      {
        name: 'B',
        columns: [
          {
            id: 'review',
            name: 'Review',
            color: '#000',
            enter: [
              { id: 'g1', script: 'npm test', label: 'CI', junk: 'x' },
              { id: 'g2', field: 'sev', check: '= high' },
              { id: 'g3', field: 'reviewer' }, // field with no check — kept
            ],
            exit: [{ id: 'x1', script: 'npm run build' }],
          },
          { id: 'todo', name: 'Todo', color: '#000' },
        ],
      },
      'b',
    );
    assert.deepStrictEqual(config.columns[0].enter, [
      { id: 'g1', label: 'CI', script: 'npm test' },
      { id: 'g2', field: 'sev', check: '= high' },
      { id: 'g3', field: 'reviewer' },
    ]);
    assert.deepStrictEqual(config.columns[0].exit, [{ id: 'x1', script: 'npm run build' }]);
  });

  test('drops entries lacking a string id or lacking both script and field', () => {
    const config = normalizeBoardConfig(
      {
        name: 'B',
        columns: [
          {
            id: 'review',
            name: 'Review',
            color: '#000',
            enter: [
              { id: 'ok', field: 'sev' },
              { id: 'noneither', label: 'nope' }, // neither script nor field — dropped
              { id: 'badtypes', script: 5, field: 7 }, // non-string script/field — dropped
              { id: '', field: 'sev' }, // empty id — dropped
              { field: 'sev' }, // no id — dropped
              null,
              'garbage',
            ],
          },
        ],
      },
      'b',
    );
    assert.deepStrictEqual(config.columns[0].enter, [{ id: 'ok', field: 'sev' }]);
  });

  test('when both script and field are present, script wins and check is dropped', () => {
    const config = normalizeBoardConfig(
      {
        name: 'B',
        columns: [
          {
            id: 'review',
            name: 'Review',
            color: '#000',
            enter: [{ id: 'g', script: 'npm test', field: 'sev', check: '= high', label: 'L' }],
          },
        ],
      },
      'b',
    );
    assert.deepStrictEqual(config.columns[0].enter, [{ id: 'g', label: 'L', script: 'npm test' }]);
  });

  test('check is dropped when there is no field (only meaningful on a field gate)', () => {
    const config = normalizeBoardConfig(
      {
        name: 'B',
        columns: [
          {
            id: 'review',
            name: 'Review',
            color: '#000',
            enter: [{ id: 'g', script: 'npm test', check: 'nonempty' }],
          },
        ],
      },
      'b',
    );
    assert.deepStrictEqual(config.columns[0].enter, [{ id: 'g', script: 'npm test' }]);
  });

  test('columns without gates carry no enter/exit keys', () => {
    const config = normalizeBoardConfig(
      { name: 'B', columns: [{ id: 'todo', name: 'Todo', color: '#000' }] },
      'b',
    );
    assert.strictEqual(config.columns[0].enter, undefined);
    assert.strictEqual(config.columns[0].exit, undefined);
  });
});
