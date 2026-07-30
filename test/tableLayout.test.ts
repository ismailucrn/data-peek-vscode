import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  VIRTUAL_OVERSCAN,
  calculateVirtualColumns,
  calculateVirtualRange,
  clampColumnWidth,
  estimateColumnWidth,
  navigateSelection
} from '../src/tableLayout';

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

test('calculates bounded virtual row and variable-width column windows', () => {
  assert.deepEqual(calculateVirtualRange(5_000, 34, 1_700, 340), {
    start: 40,
    end: 70
  });
  assert.deepEqual(calculateVirtualRange(4, 34, 0, 340), { start: 0, end: 4 });

  const columns = calculateVirtualColumns([100, 200, 80, 120, 160], 250, 180, 1);
  assert.deepEqual(columns, {
    start: 0,
    end: 5,
    before: 0,
    after: 0,
    total: 660
  });
});

test('keeps the virtual DOM window proportional at configured row and column limits', () => {
  const rows = calculateVirtualRange(5_000, 34, 80_000, 680);
  const columns = calculateVirtualColumns(Array.from({ length: 500 }, () => 160), 30_000, 960);
  assert.ok(rows.end - rows.start <= 20 + VIRTUAL_OVERSCAN * 2);
  assert.ok(columns.end - columns.start <= 7 + VIRTUAL_OVERSCAN * 2);
  assert.ok((rows.end - rows.start) * (columns.end - columns.start) < 2_000);
});
