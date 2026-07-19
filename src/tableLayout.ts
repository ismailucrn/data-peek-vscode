import { CellSelection, SerializableCell } from './types';

export const MIN_COLUMN_WIDTH = 72;
export const MAX_COLUMN_WIDTH = 600;
export const DEFAULT_COLUMN_WIDTH = 160;
export const VIRTUAL_ROW_HEIGHT = 34;
export const VIRTUAL_HEADER_HEIGHT = 36;
export const VIRTUAL_OVERSCAN = 10;

export interface VirtualRange {
  start: number;
  end: number;
}

export interface VirtualColumnRange extends VirtualRange {
  before: number;
  after: number;
  total: number;
}

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

export function calculateVirtualRange(
  itemCount: number,
  itemSize: number,
  viewportStart: number,
  viewportSize: number,
  overscan = VIRTUAL_OVERSCAN
): VirtualRange {
  if (itemCount <= 0 || itemSize <= 0) return { start: 0, end: 0 };
  const safeStart = Math.max(0, viewportStart);
  const firstVisible = Math.min(itemCount - 1, Math.floor(safeStart / itemSize));
  const visibleCount = Math.max(1, Math.ceil(Math.max(0, viewportSize) / itemSize));
  return {
    start: Math.max(0, firstVisible - Math.max(0, overscan)),
    end: Math.min(itemCount, firstVisible + visibleCount + Math.max(0, overscan))
  };
}

export function calculateVirtualColumns(
  widths: number[],
  viewportStart: number,
  viewportSize: number,
  overscan = VIRTUAL_OVERSCAN
): VirtualColumnRange {
  if (!widths.length) return { start: 0, end: 0, before: 0, after: 0, total: 0 };

  const safeStart = Math.max(0, viewportStart);
  const safeEnd = safeStart + Math.max(0, viewportSize);
  let offset = 0;
  let firstVisible = widths.length - 1;
  let endVisible = widths.length;
  let foundFirst = false;
  for (let index = 0; index < widths.length; index += 1) {
    const width = Math.max(0, widths[index]);
    const nextOffset = offset + width;
    if (!foundFirst && nextOffset > safeStart) {
      firstVisible = index;
      foundFirst = true;
    }
    if (endVisible === widths.length && offset >= safeEnd) {
      endVisible = index;
    }
    offset = nextOffset;
  }

  const start = Math.max(0, firstVisible - Math.max(0, overscan));
  const end = Math.min(widths.length, endVisible + Math.max(0, overscan));
  let before = 0;
  let rendered = 0;
  for (let index = 0; index < end; index += 1) {
    const width = Math.max(0, widths[index]);
    if (index < start) before += width;
    else rendered += width;
  }
  return { start, end, before, after: Math.max(0, offset - before - rendered), total: offset };
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
