export type SerializableCell = string | number | boolean | null;

export type FilterOperator =
  | 'contains'
  | 'notContains'
  | 'equals'
  | 'notEquals'
  | 'startsWith'
  | 'endsWith'
  | 'greaterThan'
  | 'greaterThanOrEqual'
  | 'lessThan'
  | 'lessThanOrEqual'
  | 'between'
  | 'isTrue'
  | 'isFalse'
  | 'isEmpty'
  | 'isNotEmpty';

export interface ColumnFilter {
  id: string;
  columnIndex: number;
  operator: FilterOperator;
  value?: string;
  secondValue?: string;
}

export interface SortState {
  columnIndex: number;
  direction: 'asc' | 'desc';
}

export interface CellSelection {
  rowIndex: number;
  columnIndex: number;
}

export interface TableViewState {
  query: string;
  filters: ColumnFilter[];
  sort?: SortState;
  ui?: {
    pageSize?: 25 | 50 | 100 | 250;
    columnWidths?: Record<string, number>;
    hiddenColumns?: number[];
    pinnedColumns?: number[];
    selectedCell?: CellSelection;
  };
}

export interface IndexedRow {
  row: SerializableCell[];
  index: number;
}

export interface ColumnProfile {
  name: string;
  type: 'number' | 'boolean' | 'date' | 'text' | 'mixed' | 'empty';
  missing: number;
  nonNull: number;
  distinct: number;
  min?: string | number;
  max?: string | number;
  mean?: number;
}

export interface DatasetPreview {
  fileName: string;
  format: 'CSV' | 'TSV' | 'PARQUET' | 'EXCEL';
  fileSize: number;
  columns: string[];
  totalColumns: number;
  truncatedColumns: boolean;
  rows: SerializableCell[][];
  profiles: ColumnProfile[];
  previewRowCount: number;
  totalRows: number | null;
  truncated: boolean;
  sheet?: string;
  sheets?: string[];
}

export type CopyKind = 'cell' | 'row' | 'columnName';

export type WebviewToHostMessage =
  | { type: 'ready' }
  | { type: 'reload' }
  | { type: 'selectSheet'; sheet: string }
  | { type: 'copy'; kind: CopyKind; rowIndex: number; columnIndex: number };

export type HostToWebviewMessage =
  | { type: 'loading' }
  | { type: 'dataset'; payload: DatasetPreview }
  | { type: 'error'; message: string }
  | { type: 'operationResult'; operation: 'copy'; success: boolean; message: string };

export interface PreviewOptions {
  limit: number;
  maxExcelFileSizeMB: number;
  maxExcelExpandedSizeMB: number;
  maxColumns: number;
  sheet?: string;
}
