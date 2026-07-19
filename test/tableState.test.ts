import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyTableView,
  filterValidationError,
  normalizeTableViewState,
  operatorsForType
} from '../src/tableState';
import { DatasetPreview, TableViewState } from '../src/types';

const dataset: DatasetPreview = {
  fileName: 'people.csv',
  format: 'CSV',
  fileSize: 100,
  columns: ['name', 'score', 'joined', 'active'],
  totalColumns: 4,
  truncatedColumns: false,
  rows: [
    ['Ada', 10, '2024-01-03', true],
    ['Grace', null, '2023-06-15', false],
    ['Alan', 10, '2024-02-01', true],
    [null, 25, null, null]
  ],
  profiles: [
    {
      name: 'name', type: 'text', missing: 1, nonNull: 3, distinct: 3,
      missingRatio: 0.25, uniqueRatio: 1, topValues: []
    },
    {
      name: 'score', type: 'number', missing: 1, nonNull: 3, distinct: 2,
      missingRatio: 0.25, uniqueRatio: 2 / 3, topValues: []
    },
    {
      name: 'joined', type: 'date', missing: 1, nonNull: 3, distinct: 3,
      missingRatio: 0.25, uniqueRatio: 1, topValues: []
    },
    {
      name: 'active', type: 'boolean', missing: 1, nonNull: 3, distinct: 2,
      missingRatio: 0.25, uniqueRatio: 2 / 3, topValues: []
    }
  ],
  previewRowCount: 4,
  totalRows: 4,
  truncated: false,
  truncation: { rows: false, columns: false, cells: 0 },
  qualityWarnings: [],
  profileScope: 'preview'
};

test('combines global search and column filters with AND semantics', () => {
  const state: TableViewState = {
    query: 'a',
    filters: [
      { id: 'minimum', columnIndex: 1, operator: 'greaterThanOrEqual', value: '10' },
      { id: 'active', columnIndex: 3, operator: 'isTrue' }
    ]
  };
  assert.deepEqual(
    applyTableView(dataset, state).map((item) => item.index),
    [0, 2]
  );
});

test('supports inclusive numeric and date ranges', () => {
  const numeric = applyTableView(dataset, {
    query: '',
    filters: [
      { id: 'range', columnIndex: 1, operator: 'between', value: '20', secondValue: '10' }
    ]
  });
  assert.deepEqual(
    numeric.map((item) => item.index),
    [0, 2]
  );

  const dates = applyTableView(dataset, {
    query: '',
    filters: [
      {
        id: 'dates',
        columnIndex: 2,
        operator: 'between',
        value: '2024-01-01',
        secondValue: '2024-01-31'
      }
    ]
  });
  assert.deepEqual(
    dates.map((item) => item.index),
    [0]
  );
});

test('supports every text operator case-insensitively', () => {
  const cases: Array<[TableViewState['filters'][number]['operator'], string | undefined, number[]]> = [
    ['contains', 'AD', [0]],
    ['notContains', 'D', [1, 2]],
    ['equals', 'ada', [0]],
    ['notEquals', 'ADA', [1, 2]],
    ['startsWith', 'GR', [1]],
    ['endsWith', 'AN', [2]],
    ['isEmpty', undefined, [3]],
    ['isNotEmpty', undefined, [0, 1, 2]]
  ];
  for (const [operator, value, expected] of cases) {
    const actual = applyTableView(dataset, {
      query: '',
      filters: [{ id: operator, columnIndex: 0, operator, value }]
    }).map((item) => item.index);
    assert.deepEqual(actual, expected, operator);
  }
});

test('supports every ordered comparison and excludes null cells', () => {
  const cases: Array<[TableViewState['filters'][number]['operator'], string | undefined, number[]]> = [
    ['equals', '10', [0, 2]],
    ['notEquals', '10', [3]],
    ['greaterThan', '10', [3]],
    ['greaterThanOrEqual', '10', [0, 2, 3]],
    ['lessThan', '25', [0, 2]],
    ['lessThanOrEqual', '10', [0, 2]],
    ['isEmpty', undefined, [1]],
    ['isNotEmpty', undefined, [0, 2, 3]]
  ];
  for (const [operator, value, expected] of cases) {
    const actual = applyTableView(dataset, {
      query: '',
      filters: [{ id: operator, columnIndex: 1, operator, value }]
    }).map((item) => item.index);
    assert.deepEqual(actual, expected, operator);
  }
});

test('supports boolean and null operators', () => {
  const cases: Array<[TableViewState['filters'][number]['operator'], number[]]> = [
    ['isTrue', [0, 2]],
    ['isFalse', [1]],
    ['isEmpty', [3]],
    ['isNotEmpty', [0, 1, 2]]
  ];
  for (const [operator, expected] of cases) {
    const actual = applyTableView(dataset, {
      query: '',
      filters: [{ id: operator, columnIndex: 3, operator }]
    }).map((item) => item.index);
    assert.deepEqual(actual, expected, operator);
  }
});

test('keeps null values last and preserves stable sort order', () => {
  const ascending = applyTableView(dataset, {
    query: '',
    filters: [],
    sort: { columnIndex: 1, direction: 'asc' }
  });
  assert.deepEqual(
    ascending.map((item) => item.index),
    [0, 2, 3, 1]
  );

  const descending = applyTableView(dataset, {
    query: '',
    filters: [],
    sort: { columnIndex: 1, direction: 'desc' }
  });
  assert.deepEqual(
    descending.map((item) => item.index),
    [3, 0, 2, 1]
  );
});

test('validates typed filter inputs and available operators', () => {
  assert.deepEqual(operatorsForType('boolean'), ['isTrue', 'isFalse', 'isEmpty', 'isNotEmpty']);
  assert.equal(
    filterValidationError(
      { id: 'invalid', columnIndex: 1, operator: 'greaterThan', value: 'ten' },
      'number'
    ),
    'Enter a valid number.'
  );
  assert.equal(
    filterValidationError(
      { id: 'invalid', columnIndex: 2, operator: 'greaterThan', value: 'not-a-date' },
      'date'
    ),
    'Enter a valid date.'
  );
});

test('normalizes restored state against the current dataset', () => {
  const state = normalizeTableViewState(
    {
      query: 'Ada',
      filters: [
        { id: 'valid', columnIndex: 0, operator: 'contains', value: 'ad' },
        { id: 'wrong-type', columnIndex: 1, operator: 'contains', value: '1' },
        { id: 'outside', columnIndex: 99, operator: 'contains', value: 'x' }
      ],
      sort: { columnIndex: 2, direction: 'desc' }
    },
    dataset
  );
  assert.equal(state.query, 'Ada');
  assert.deepEqual(state.filters.map((filter) => filter.id), ['valid']);
  assert.deepEqual(state.sort, { columnIndex: 2, direction: 'desc' });
});

test('restores only supported pagination preferences', () => {
  assert.deepEqual(
    normalizeTableViewState({ query: '', filters: [], ui: { pageSize: 100 } }, dataset),
    { query: '', filters: [], ui: { pageSize: 100 } }
  );
  assert.deepEqual(
    normalizeTableViewState({ query: '', filters: [], ui: { pageSize: 999 } }, dataset),
    { query: '', filters: [] }
  );
});

test('bounds restored column layout and cell selection state', () => {
  assert.deepEqual(
    normalizeTableViewState(
      {
        query: '',
        filters: [],
        ui: {
          columnWidths: { 0: 12, 1: 240.4, 99: 300 },
          hiddenColumns: [1, 1, 99],
          pinnedColumns: [1, 2, 2],
          selectedCell: { rowIndex: 2, columnIndex: 3 }
        }
      },
      dataset
    ),
    {
      query: '',
      filters: [],
      ui: {
        columnWidths: { 0: 72, 1: 240 },
        hiddenColumns: [1],
        pinnedColumns: [2],
        selectedCell: { rowIndex: 2, columnIndex: 3 }
      }
    }
  );
});

test('restores bounded profile search and collapse preferences', () => {
  const normalized = normalizeTableViewState(
    {
      query: '',
      filters: [],
      ui: { profilesCollapsed: true, profileQuery: 'x'.repeat(300) }
    },
    dataset
  );
  assert.equal(normalized.ui?.profilesCollapsed, true);
  assert.equal(normalized.ui?.profileQuery?.length, 200);
});
