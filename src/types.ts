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

export interface TableViewState {
  query: string;
  filters: ColumnFilter[];
  sort?: SortState;
  ui?: {
    pageSize?: 25 | 50 | 100 | 250;
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

export interface PreviewOptions {
  limit: number;
  maxExcelFileSizeMB: number;
  maxExcelExpandedSizeMB: number;
  maxColumns: number;
  sheet?: string;
}
