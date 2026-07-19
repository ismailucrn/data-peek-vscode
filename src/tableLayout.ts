import { CellSelection, SerializableCell } from './types';

export const MIN_COLUMN_WIDTH = 72;
export const MAX_COLUMN_WIDTH = 600;
export const DEFAULT_COLUMN_WIDTH = 160;

export type NavigationKey =
  | 'ArrowLeft'
  | 'ArrowRight'
  | 'ArrowUp'
  | 'ArrowDown'
  | 'Home'
  | 'End'
  | 'PageUp'
  | 'PageDown';

export function visibleColumnOrder(
  columnCount: number,
  hiddenColumns: number[],
  pinnedColumns: number[]
): number[] {
  const hidden = new Set(hiddenColumns);
  const visiblePinned = pinnedColumns.filter(
    (columnIndex, index) =>
      columnIndex >= 0 &&
      columnIndex < columnCount &&
      !hidden.has(columnIndex) &&
      pinnedColumns.indexOf(columnIndex) === index
  );
  const pinned = new Set(visiblePinned);
  const remaining = Array.from({ length: columnCount }, (_, index) => index).filter(
    (columnIndex) => !hidden.has(columnIndex) && !pinned.has(columnIndex)
  );
  return [...visiblePinned, ...remaining];
}

export function clampColumnWidth(width: number): number {
  return Math.round(Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, width)));
}

export function estimateColumnWidth(columnName: string, values: SerializableCell[]): number {
  const longest = values.reduce<number>(
    (length, value) => Math.max(length, value === null ? 4 : String(value).length),
    columnName.length
  );
  return clampColumnWidth(longest * 7.5 + 72);
}

export function navigateSelection(
  selection: CellSelection,
  key: NavigationKey,
  rowOrder: number[],
  columnOrder: number[],
  pageSize: number
): CellSelection {
  if (!rowOrder.length || !columnOrder.length) return selection;
  let rowPosition = Math.max(0, rowOrder.indexOf(selection.rowIndex));
  let columnPosition = Math.max(0, columnOrder.indexOf(selection.columnIndex));
  switch (key) {
    case 'ArrowLeft':
      columnPosition = Math.max(0, columnPosition - 1);
      break;
    case 'ArrowRight':
      columnPosition = Math.min(columnOrder.length - 1, columnPosition + 1);
      break;
    case 'ArrowUp':
      rowPosition = Math.max(0, rowPosition - 1);
      break;
    case 'ArrowDown':
      rowPosition = Math.min(rowOrder.length - 1, rowPosition + 1);
      break;
    case 'Home':
      columnPosition = 0;
      break;
    case 'End':
      columnPosition = columnOrder.length - 1;
      break;
    case 'PageUp':
      rowPosition = Math.max(0, rowPosition - pageSize);
      break;
    case 'PageDown':
      rowPosition = Math.min(rowOrder.length - 1, rowPosition + pageSize);
      break;
  }
  return { rowIndex: rowOrder[rowPosition], columnIndex: columnOrder[columnPosition] };
}
