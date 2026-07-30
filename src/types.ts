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
    columnWidths?: Record<string, number>;
    selectedCell?: CellSelection;
    profilesCollapsed?: boolean;
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
  median?: number;
  standardDeviation?: number;
  missingRatio: number;
  uniqueRatio: number;
  minLength?: number;
  maxLength?: number;
  histogram?: Array<{
    start: number;
    end: number;
    count: number;
  }>;
  topValues: Array<{
    value: SerializableCell;
    count: number;
  }>;
  approximateMetrics?: Array<'distinct' | 'median' | 'histogram' | 'topValues'>;
}

export interface FullProfileResult {
  profiles: ColumnProfile[];
  rowCount: number;
}

export type QualityWarningCode =
  | 'mixedType'
  | 'allEmpty'
  | 'constant'
  | 'highMissing'
  | 'possibleIdentifier'
  | 'duplicateRows'
  | 'truncatedRows'
  | 'truncatedColumns'
  | 'truncatedCells';

export interface QualityWarning {
  code: QualityWarningCode;
  message: string;
  columnIndex?: number;
  count?: number;
}

export interface TruncationInfo {
  rows: boolean;
  columns: boolean;
  cells: number;
}

export type DelimiterOption = 'auto' | 'comma' | 'semicolon' | 'tab' | 'pipe' | 'custom';
export type DelimitedEncoding = 'utf8' | 'utf16le' | 'latin1';
export type HeaderMode = 'firstNonEmpty' | 'none';
export type DecimalSeparator = 'dot' | 'comma';
export type ThousandsSeparator = 'none' | 'comma' | 'dot' | 'space';

export interface DelimitedParsingSettings {
  delimiter: DelimiterOption;
  customDelimiter?: string;
  encoding: DelimitedEncoding;
  header: HeaderMode;
  skipRows: number;
  quote: string;
  escape: string;
  nullTokens: string[];
  decimalSeparator: DecimalSeparator;
  thousandsSeparator: ThousandsSeparator;
}

export interface DelimitedParsingMetadata {
  detectedDelimiter: string;
  resolvedDelimiter: string;
  applied: DelimitedParsingSettings;
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
  truncation: TruncationInfo;
  qualityWarnings: QualityWarning[];
  profileScope: 'preview' | 'full';
  profiledRowCount: number;
  parsing?: DelimitedParsingMetadata;
  sheet?: string;
  sheets?: string[];
}

export type CopyKind = 'cell' | 'row' | 'columnName';

export type WebviewToHostMessage =
  | { type: 'ready' }
  | { type: 'reload' }
  | { type: 'selectSheet'; sheet: string }
  | { type: 'updateParsing'; settings: unknown }
  | { type: 'copy'; kind: CopyKind; rowIndex: number; columnIndex: number };

export type HostToWebviewMessage =
  | { type: 'loading' }
  | { type: 'dataset'; payload: DatasetPreview }
  | { type: 'profileProgress'; processedRows: number; totalRows: number | null }
  | { type: 'profiles'; payload: FullProfileResult }
  | { type: 'profileError'; message: string }
  | { type: 'error'; message: string }
  | {
      type: 'operationResult';
      operation: 'copy' | 'parsing';
      success: boolean;
      message: string;
    };

export interface PreviewOptions {
  limit: number;
  maxExcelFileSizeMB: number;
  maxExcelExpandedSizeMB: number;
  maxColumns: number;
  sheet?: string;
  parsing?: unknown;
  isCancelled?: () => boolean;
}

export interface FullProfileOptions extends PreviewOptions {
  columns: string[];
  maxProfileScanSizeMB: number;
  onProgress?: (processedRows: number, totalRows: number | null) => void;
}
