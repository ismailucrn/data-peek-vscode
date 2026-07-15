export type SerializableCell = string | number | boolean | null;

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
