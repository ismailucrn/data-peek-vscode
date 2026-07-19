import {
  ColumnFilter,
  ColumnProfile,
  DatasetPreview,
  FilterOperator,
  IndexedRow,
  SerializableCell,
  TableViewState
} from './types';

const TEXT_OPERATORS: FilterOperator[] = [
  'contains',
  'notContains',
  'equals',
  'notEquals',
  'startsWith',
  'endsWith',
  'isEmpty',
  'isNotEmpty'
];
const ORDERED_OPERATORS: FilterOperator[] = [
  'equals',
  'notEquals',
  'greaterThan',
  'greaterThanOrEqual',
  'lessThan',
  'lessThanOrEqual',
  'between',
  'isEmpty',
  'isNotEmpty'
];
const BOOLEAN_OPERATORS: FilterOperator[] = ['isTrue', 'isFalse', 'isEmpty', 'isNotEmpty'];
const ALL_OPERATORS = new Set<FilterOperator>([
  ...TEXT_OPERATORS,
  ...ORDERED_OPERATORS,
  ...BOOLEAN_OPERATORS
]);
const NO_VALUE_OPERATORS = new Set<FilterOperator>([
  'isTrue',
  'isFalse',
  'isEmpty',
  'isNotEmpty'
]);
const MAX_QUERY_LENGTH = 2_000;
const MAX_FILTERS = 100;
const MAX_FILTER_VALUE_LENGTH = 2_000;

export const EMPTY_TABLE_VIEW_STATE: TableViewState = {
  query: '',
  filters: []
};

export function operatorsForType(type: ColumnProfile['type']): FilterOperator[] {
  if (type === 'number' || type === 'date') return [...ORDERED_OPERATORS];
  if (type === 'boolean') return [...BOOLEAN_OPERATORS];
  return [...TEXT_OPERATORS];
}

export function operatorNeedsValue(operator: FilterOperator): boolean {
  return !NO_VALUE_OPERATORS.has(operator);
}

export function filterValidationError(
  filter: ColumnFilter,
  type: ColumnProfile['type']
): string | null {
  if (!Number.isInteger(filter.columnIndex) || filter.columnIndex < 0) {
    return 'Select a valid column.';
  }
  if (!operatorsForType(type).includes(filter.operator)) {
    return 'This operator is not available for the column type.';
  }
  if (!operatorNeedsValue(filter.operator)) return null;

  const value = filter.value?.trim() ?? '';
  if (!value) return 'Enter a filter value.';
  if (value.length > MAX_FILTER_VALUE_LENGTH) return 'Filter values are limited to 2,000 characters.';

  if (filter.operator === 'between') {
    const secondValue = filter.secondValue?.trim() ?? '';
    if (!secondValue) return 'Enter both ends of the range.';
    if (secondValue.length > MAX_FILTER_VALUE_LENGTH) {
      return 'Filter values are limited to 2,000 characters.';
    }
  }

  if (type === 'number') {
    if (!isFiniteNumber(value)) return 'Enter a valid number.';
    if (filter.operator === 'between' && !isFiniteNumber(filter.secondValue ?? '')) {
      return 'Enter a valid number for both ends of the range.';
    }
  }
  if (type === 'date') {
    if (!isValidDate(value)) return 'Enter a valid date.';
    if (filter.operator === 'between' && !isValidDate(filter.secondValue ?? '')) {
      return 'Enter a valid date for both ends of the range.';
    }
  }
  return null;
}

export function normalizeTableViewState(value: unknown, dataset: DatasetPreview): TableViewState {
  if (!value || typeof value !== 'object') return { ...EMPTY_TABLE_VIEW_STATE, filters: [] };
  const candidate = value as Record<string, unknown>;
  const query =
    typeof candidate.query === 'string' ? candidate.query.slice(0, MAX_QUERY_LENGTH) : '';
  const filters = Array.isArray(candidate.filters)
    ? candidate.filters
        .slice(0, MAX_FILTERS)
        .map(normalizeFilter)
        .filter((filter): filter is ColumnFilter => {
          if (!filter || filter.columnIndex >= dataset.columns.length) return false;
          const type = dataset.profiles[filter.columnIndex]?.type ?? 'text';
          return filterValidationError(filter, type) === null;
        })
    : [];

  let sort: TableViewState['sort'];
  if (candidate.sort && typeof candidate.sort === 'object') {
    const rawSort = candidate.sort as Record<string, unknown>;
    if (
      Number.isInteger(rawSort.columnIndex) &&
      (rawSort.columnIndex as number) >= 0 &&
      (rawSort.columnIndex as number) < dataset.columns.length &&
      (rawSort.direction === 'asc' || rawSort.direction === 'desc')
    ) {
      sort = {
        columnIndex: rawSort.columnIndex as number,
        direction: rawSort.direction
      };
    }
  }
  const pageSize = normalizePageSize(
    candidate.ui && typeof candidate.ui === 'object'
      ? (candidate.ui as Record<string, unknown>).pageSize
      : undefined
  );
  const rawUi =
    candidate.ui && typeof candidate.ui === 'object'
      ? (candidate.ui as Record<string, unknown>)
      : undefined;
  const columnWidths = normalizeColumnWidths(rawUi?.columnWidths, dataset.columns.length);
  const hiddenColumns = normalizeColumnIndexes(rawUi?.hiddenColumns, dataset.columns.length);
  const pinnedColumns = normalizeColumnIndexes(rawUi?.pinnedColumns, dataset.columns.length).filter(
    (columnIndex) => !hiddenColumns.includes(columnIndex)
  );
  const selectedCell = normalizeSelection(
    rawUi?.selectedCell,
    dataset.rows.length,
    dataset.columns.length
  );
  const ui =
    pageSize || columnWidths || hiddenColumns.length || pinnedColumns.length || selectedCell
      ? {
          ...(pageSize ? { pageSize } : {}),
          ...(columnWidths ? { columnWidths } : {}),
          ...(hiddenColumns.length ? { hiddenColumns } : {}),
          ...(pinnedColumns.length ? { pinnedColumns } : {}),
          ...(selectedCell ? { selectedCell } : {})
        }
      : undefined;
  return {
    query,
    filters,
    ...(sort ? { sort } : {}),
    ...(ui ? { ui } : {})
  };
}

export function applyTableView(dataset: DatasetPreview, state: TableViewState): IndexedRow[] {
  const query = state.query.trim().toLowerCase();
  const rows = dataset.rows.map((row, index) => ({ row, index }));
  const filtered = rows.filter((item) => {
    if (
      query &&
      !item.row.some(
        (value) => value !== null && String(value).toLowerCase().includes(query)
      )
    ) {
      return false;
    }
    return state.filters.every((filter) => {
      const type = dataset.profiles[filter.columnIndex]?.type ?? 'text';
      return matchesFilter(item.row[filter.columnIndex] ?? null, filter, type);
    });
  });

  if (!state.sort) return filtered;
  const { columnIndex, direction } = state.sort;
  const type = dataset.profiles[columnIndex]?.type ?? 'text';
  return filtered
    .map((item, stableIndex) => ({ item, stableIndex }))
    .sort((left, right) => {
      const comparison = compareCells(
        left.item.row[columnIndex] ?? null,
        right.item.row[columnIndex] ?? null,
        type,
        direction
      );
      return comparison || left.stableIndex - right.stableIndex;
    })
    .map(({ item }) => item);
}

function normalizeFilter(value: unknown): ColumnFilter | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.id !== 'string' ||
    candidate.id.length === 0 ||
    candidate.id.length > 128 ||
    !Number.isInteger(candidate.columnIndex) ||
    (candidate.columnIndex as number) < 0 ||
    typeof candidate.operator !== 'string' ||
    !ALL_OPERATORS.has(candidate.operator as FilterOperator)
  ) {
    return null;
  }
  return {
    id: candidate.id,
    columnIndex: candidate.columnIndex as number,
    operator: candidate.operator as FilterOperator,
    value:
      typeof candidate.value === 'string'
        ? candidate.value.slice(0, MAX_FILTER_VALUE_LENGTH)
        : undefined,
    secondValue:
      typeof candidate.secondValue === 'string'
        ? candidate.secondValue.slice(0, MAX_FILTER_VALUE_LENGTH)
        : undefined
  };
}

function matchesFilter(
  cell: SerializableCell,
  filter: ColumnFilter,
  type: ColumnProfile['type']
): boolean {
  if (filter.operator === 'isEmpty') return cell === null;
  if (filter.operator === 'isNotEmpty') return cell !== null;
  if (cell === null) return false;
  if (filter.operator === 'isTrue') return cell === true || String(cell).toLowerCase() === 'true';
  if (filter.operator === 'isFalse') {
    return cell === false || String(cell).toLowerCase() === 'false';
  }

  if (type === 'number' || type === 'date') {
    const left = type === 'number' ? Number(cell) : Date.parse(String(cell));
    const right = type === 'number' ? Number(filter.value) : Date.parse(filter.value ?? '');
    const upper =
      type === 'number' ? Number(filter.secondValue) : Date.parse(filter.secondValue ?? '');
    if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
    switch (filter.operator) {
      case 'equals':
        return left === right;
      case 'notEquals':
        return left !== right;
      case 'greaterThan':
        return left > right;
      case 'greaterThanOrEqual':
        return left >= right;
      case 'lessThan':
        return left < right;
      case 'lessThanOrEqual':
        return left <= right;
      case 'between': {
        if (!Number.isFinite(upper)) return false;
        const minimum = Math.min(right, upper);
        const maximum = Math.max(right, upper);
        return left >= minimum && left <= maximum;
      }
      default:
        return false;
    }
  }

  const left = String(cell).toLowerCase();
  const right = (filter.value ?? '').toLowerCase();
  switch (filter.operator) {
    case 'contains':
      return left.includes(right);
    case 'notContains':
      return !left.includes(right);
    case 'equals':
      return left === right;
    case 'notEquals':
      return left !== right;
    case 'startsWith':
      return left.startsWith(right);
    case 'endsWith':
      return left.endsWith(right);
    default:
      return false;
  }
}

function compareCells(
  left: SerializableCell,
  right: SerializableCell,
  type: ColumnProfile['type'],
  direction: 'asc' | 'desc'
): number {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;

  let comparison: number;
  if (type === 'number') {
    comparison = Number(left) - Number(right);
  } else if (type === 'date') {
    comparison = Date.parse(String(left)) - Date.parse(String(right));
  } else if (type === 'boolean') {
    comparison = Number(left === true || String(left).toLowerCase() === 'true') -
      Number(right === true || String(right).toLowerCase() === 'true');
  } else {
    comparison = String(left).localeCompare(String(right), 'en', {
      numeric: true,
      sensitivity: 'base'
    });
  }
  if (!Number.isFinite(comparison)) {
    comparison = String(left).localeCompare(String(right), 'en', {
      numeric: true,
      sensitivity: 'base'
    });
  }
  return direction === 'asc' ? comparison : -comparison;
}

function isFiniteNumber(value: string): boolean {
  return value.trim().length > 0 && Number.isFinite(Number(value));
}

function isValidDate(value: string): boolean {
  return value.trim().length > 0 && Number.isFinite(Date.parse(value));
}

function normalizePageSize(value: unknown): 25 | 50 | 100 | 250 | undefined {
  return value === 25 || value === 50 || value === 100 || value === 250 ? value : undefined;
}

function normalizeColumnWidths(
  value: unknown,
  columnCount: number
): Record<string, number> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const widths: Record<string, number> = {};
  for (const [key, rawWidth] of Object.entries(value as Record<string, unknown>)) {
    const columnIndex = Number(key);
    if (
      Number.isInteger(columnIndex) &&
      columnIndex >= 0 &&
      columnIndex < columnCount &&
      typeof rawWidth === 'number' &&
      Number.isFinite(rawWidth)
    ) {
      widths[String(columnIndex)] = Math.round(Math.min(600, Math.max(72, rawWidth)));
    }
  }
  return Object.keys(widths).length ? widths : undefined;
}

function normalizeColumnIndexes(value: unknown, columnCount: number): number[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value)].filter(
    (columnIndex): columnIndex is number =>
      typeof columnIndex === 'number' &&
      Number.isInteger(columnIndex) &&
      columnIndex >= 0 &&
      columnIndex < columnCount
  );
}

function normalizeSelection(
  value: unknown,
  rowCount: number,
  columnCount: number
): { rowIndex: number; columnIndex: number } | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.rowIndex !== 'number' ||
    !Number.isInteger(candidate.rowIndex) ||
    candidate.rowIndex < 0 ||
    candidate.rowIndex >= rowCount ||
    typeof candidate.columnIndex !== 'number' ||
    !Number.isInteger(candidate.columnIndex) ||
    candidate.columnIndex < 0 ||
    candidate.columnIndex >= columnCount
  ) {
    return undefined;
  }
  return { rowIndex: candidate.rowIndex, columnIndex: candidate.columnIndex };
}
