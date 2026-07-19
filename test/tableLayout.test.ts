import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  clampColumnWidth,
  estimateColumnWidth,
  navigateSelection,
  visibleColumnOrder
} from '../src/tableLayout';

test('orders pinned columns first and omits hidden columns', () => {
  assert.deepEqual(visibleColumnOrder(6, [1, 4], [3, 1, 3]), [3, 0, 2, 5]);
});

test('clamps and estimates column widths', () => {
  assert.equal(clampColumnWidth(10), MIN_COLUMN_WIDTH);
  assert.equal(clampColumnWidth(1_000), MAX_COLUMN_WIDTH);
  assert.equal(estimateColumnWidth('name', ['Ada', 'Grace']), 110);
  assert.equal(estimateColumnWidth('name', ['x'.repeat(200)]), MAX_COLUMN_WIDTH);
});

test('navigates cells using visible row and column order', () => {
  const rows = [4, 8, 12, 20];
  const columns = [2, 0, 3];
  assert.deepEqual(
    navigateSelection({ rowIndex: 8, columnIndex: 0 }, 'ArrowRight', rows, columns, 2),
    { rowIndex: 8, columnIndex: 3 }
  );
  assert.deepEqual(
    navigateSelection({ rowIndex: 8, columnIndex: 0 }, 'PageDown', rows, columns, 2),
    { rowIndex: 20, columnIndex: 0 }
  );
  assert.deepEqual(
    navigateSelection({ rowIndex: 20, columnIndex: 3 }, 'Home', rows, columns, 2),
    { rowIndex: 20, columnIndex: 2 }
  );
  assert.deepEqual(
    navigateSelection({ rowIndex: 8, columnIndex: 0 }, 'ArrowLeft', rows, columns, 2),
    { rowIndex: 8, columnIndex: 2 }
  );
  assert.deepEqual(
    navigateSelection({ rowIndex: 8, columnIndex: 0 }, 'ArrowUp', rows, columns, 2),
    { rowIndex: 4, columnIndex: 0 }
  );
  assert.deepEqual(
    navigateSelection({ rowIndex: 8, columnIndex: 0 }, 'ArrowDown', rows, columns, 2),
    { rowIndex: 12, columnIndex: 0 }
  );
  assert.deepEqual(
    navigateSelection({ rowIndex: 8, columnIndex: 0 }, 'End', rows, columns, 2),
    { rowIndex: 8, columnIndex: 3 }
  );
  assert.deepEqual(
    navigateSelection({ rowIndex: 20, columnIndex: 0 }, 'PageUp', rows, columns, 2),
    { rowIndex: 8, columnIndex: 0 }
  );
});
