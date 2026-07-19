import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse';
import ExcelJS from 'exceljs';
import { buildQualityWarnings } from './dataQuality';
import { validateExcelArchive } from './excelArchive';
import { buildProfiles, isTruncatedCell, normalizeCell } from './profile';
import { DatasetPreview, PreviewOptions, SerializableCell } from './types';

const SUPPORTED_EXTENSIONS = new Set(['.csv', '.tsv', '.parquet', '.xlsx', '.xlsm']);
const MAX_CSV_RECORD_BYTES = 2 * 1024 * 1024;
const MAX_PREVIEW_CELLS = 250_000;
const MAX_PARQUET_PREVIEW_EXPANDED_BYTES = 256n * 1024n * 1024n;

export function isSupportedFile(filePath: string): boolean {
  return SUPPORTED_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export async function loadPreview(
  filePath: string,
  options: PreviewOptions
): Promise<DatasetPreview> {
  const extension = path.extname(filePath).toLowerCase();
  const stat = await fs.stat(filePath);
  const limit = clampInteger(options.limit, 100, 5000, 2000);
  const maxColumns = clampInteger(options.maxColumns, 10, 2000, 500);

  if (!stat.isFile()) {
    throw new Error('The selected resource is not a file.');
  }

  if (extension === '.csv' || extension === '.tsv') {
    return readDelimited(
      filePath,
      stat.size,
      extension === '.tsv' ? '\t' : undefined,
      limit,
      maxColumns
    );
  }
  if (extension === '.parquet') {
    return readParquet(filePath, stat.size, limit, maxColumns);
  }
  if (extension === '.xlsx' || extension === '.xlsm') {
    const maximumBytes =
      clampNumber(options.maxExcelFileSizeMB, 1, 1000, 100) * 1024 * 1024;
    if (stat.size > maximumBytes) {
      throw new Error(
        `This workbook is ${formatBytes(stat.size)}. Increase dataPeek.maxExcelFileSizeMB to open it.`
      );
    }
    const maxExpandedBytes =
      clampNumber(options.maxExcelExpandedSizeMB, 10, 2000, 250) * 1024 * 1024;
    await validateExcelArchive(filePath, maxExpandedBytes);
    return readExcel(filePath, stat.size, limit, maxColumns, options.sheet);
  }

  throw new Error(`Unsupported file type: ${extension || '(no extension)'}`);
}

async function readDelimited(
  filePath: string,
  fileSize: number,
  forcedDelimiter: string | undefined,
  limit: number,
  maxColumns: number
): Promise<DatasetPreview> {
  const delimiter = forcedDelimiter ?? (await detectDelimiter(filePath));
  const input = createReadStream(filePath);
  const parser = input.pipe(
    parse({
      bom: true,
      delimiter,
      relax_column_count: true,
      relax_quotes: true,
      max_record_size: MAX_CSV_RECORD_BYTES,
      skip_empty_lines: true
    })
  );

  let columns: string[] = [];
  let totalColumns = 0;
  const rows: SerializableCell[][] = [];
  let sawExtraRow = false;
  let effectiveLimit = limit;

  try {
    for await (const rawRecord of parser) {
      const rawValues = rawRecord as unknown[];
      totalColumns = Math.max(totalColumns, rawValues.length);
      const record = rawValues.slice(0, maxColumns).map(normalizeCell);
      if (columns.length === 0) {
        columns = uniqueHeaders(record);
        effectiveLimit = previewRowLimit(limit, columns.length);
        continue;
      }
      ensureColumns(columns, Math.min(record.length, maxColumns));
      effectiveLimit = previewRowLimit(limit, columns.length);
      if (rows.length >= effectiveLimit) {
        sawExtraRow = true;
        break;
      }
      rows.push(record);
    }
  } finally {
    input.destroy();
    parser.destroy();
  }

  normalizeRowWidths(rows, columns.length);
  return makePreview({
    filePath,
    format: forcedDelimiter === '\t' ? 'TSV' : 'CSV',
    fileSize,
    columns,
    totalColumns,
    rows,
    totalRows: sawExtraRow ? null : rows.length,
    truncated: sawExtraRow
  });
}

async function readParquet(
  filePath: string,
  fileSize: number,
  limit: number,
  maxColumns: number
): Promise<DatasetPreview> {
  const [{ asyncBufferFromFile, parquetMetadataAsync, parquetRead, parquetSchema }, compressorModule] =
    await Promise.all([import('hyparquet'), import('hyparquet-compressors')]);
  const file = await asyncBufferFromFile(filePath);
  const metadata = await parquetMetadataAsync(file);
  const totalRowsBigInt = metadata.num_rows;
  if (totalRowsBigInt < 0n) {
    throw new Error('Invalid Parquet metadata: negative row count.');
  }
  const totalRows =
    totalRowsBigInt <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(totalRowsBigInt) : null;
  const allColumns = parquetSchema(metadata).children.map((child) => child.element.name);
  const columns = allColumns.slice(0, maxColumns);
  const effectiveLimit = previewRowLimit(limit, columns.length);
  validateParquetPreviewSize(metadata.row_groups, new Set(columns), effectiveLimit);
  const rowEnd = Number(
    totalRowsBigInt < BigInt(effectiveLimit) ? totalRowsBigInt : BigInt(effectiveLimit)
  );
  let rawRows: unknown[][] = [];
  await parquetRead({
    file,
    columns,
    rowStart: 0,
    rowEnd,
    compressors: compressorModule.compressors,
    onComplete: (data) => {
      rawRows = data as unknown[][];
    }
  });
  const rows = rawRows.map((row) => columns.map((_column, index) => normalizeCell(row[index])));

  return makePreview({
    filePath,
    format: 'PARQUET',
    fileSize,
    columns,
    totalColumns: allColumns.length,
    rows,
    totalRows,
    truncated: totalRowsBigInt > BigInt(rows.length)
  });
}

async function readExcel(
  filePath: string,
  fileSize: number,
  limit: number,
  maxColumns: number,
  requestedSheet?: string
): Promise<DatasetPreview> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheets = workbook.worksheets.map((worksheet) => worksheet.name);
  const worksheet =
    (requestedSheet ? workbook.getWorksheet(requestedSheet) : undefined) ?? workbook.worksheets[0];

  if (!worksheet) {
    throw new Error('The workbook does not contain a worksheet.');
  }

  let headerRowNumber = 0;
  for (let rowNumber = 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    if (row.hasValues) {
      headerRowNumber = rowNumber;
      break;
    }
  }

  if (headerRowNumber === 0) {
    return makePreview({
      filePath,
      format: 'EXCEL',
      fileSize,
      columns: [],
      rows: [],
      totalRows: 0,
      truncated: false,
      sheet: worksheet.name,
      sheets
    });
  }

  const headerRow = worksheet.getRow(headerRowNumber);
  const totalColumns = Math.max(headerRow.cellCount, worksheet.actualColumnCount);
  const width = Math.min(totalColumns, maxColumns);
  const columns = uniqueHeaders(
    Array.from({ length: width }, (_, index) => excelCellValue(headerRow.getCell(index + 1)))
  );
  const rows: SerializableCell[][] = [];
  const effectiveLimit = previewRowLimit(limit, columns.length);
  let sawExtraRow = false;

  for (let rowNumber = headerRowNumber + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const values = columns.map((_column, index) => excelCellValue(row.getCell(index + 1)));
    if (values.every((value) => value === null)) {
      continue;
    }
    if (rows.length >= effectiveLimit) {
      sawExtraRow = true;
      break;
    }
    rows.push(values);
  }

  return makePreview({
    filePath,
    format: 'EXCEL',
    fileSize,
    columns,
    totalColumns,
    rows,
    totalRows: sawExtraRow ? null : rows.length,
    truncated: sawExtraRow,
    sheet: worksheet.name,
    sheets
  });
}

function excelCellValue(cell: ExcelJS.Cell): SerializableCell {
  const value = cell.value;
  if (value && typeof value === 'object') {
    if ('result' in value) {
      return normalizeCell(value.result);
    }
    if ('richText' in value && Array.isArray(value.richText)) {
      return normalizeCell(value.richText.map((part) => part.text).join(''));
    }
    if ('text' in value && typeof value.text === 'string') {
      return normalizeCell(value.text);
    }
    if ('error' in value && typeof value.error === 'string') {
      return normalizeCell(value.error);
    }
  }
  return normalizeCell(value);
}

async function detectDelimiter(filePath: string): Promise<string> {
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(64 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const sample = buffer.subarray(0, bytesRead).toString('utf8').split(/\r?\n/, 5).join('\n');
    const candidates = [',', ';', '\t', '|'];
    return candidates
      .map((delimiter) => ({ delimiter, count: countOutsideQuotes(sample, delimiter) }))
      .sort((left, right) => right.count - left.count)[0]?.delimiter ?? ',';
  } finally {
    await handle.close();
  }
}

function countOutsideQuotes(text: string, delimiter: string): number {
  let inQuotes = false;
  let count = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '"') {
      if (inQuotes && text[index + 1] === '"') {
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (!inQuotes && text[index] === delimiter) {
      count += 1;
    }
  }
  return count;
}

function uniqueHeaders(values: SerializableCell[]): string[] {
  const counts = new Map<string, number>();
  return values.map((value, index) => {
    const base = String(value ?? '').trim() || `column_${index + 1}`;
    const count = (counts.get(base) ?? 0) + 1;
    counts.set(base, count);
    return count === 1 ? base : `${base}_${count}`;
  });
}

function ensureColumns(columns: string[], recordWidth: number): void {
  while (columns.length < recordWidth) {
    columns.push(`column_${columns.length + 1}`);
  }
}

function normalizeRowWidths(rows: SerializableCell[][], width: number): void {
  for (const row of rows) {
    while (row.length < width) {
      row.push(null);
    }
    if (row.length > width) {
      row.length = width;
    }
  }
}

function makePreview(input: {
  filePath: string;
  format: DatasetPreview['format'];
  fileSize: number;
  columns: string[];
  totalColumns?: number;
  rows: SerializableCell[][];
  totalRows: number | null;
  truncated: boolean;
  sheet?: string;
  sheets?: string[];
}): DatasetPreview {
  const profiles = buildProfiles(input.columns, input.rows);
  const totalColumns = input.totalColumns ?? input.columns.length;
  const truncation = {
    rows: input.truncated,
    columns: totalColumns > input.columns.length,
    cells: input.rows.reduce(
      (count, row) => count + row.filter((value) => isTruncatedCell(value)).length,
      0
    )
  };
  return {
    fileName: path.basename(input.filePath),
    format: input.format,
    fileSize: input.fileSize,
    columns: input.columns,
    totalColumns,
    truncatedColumns: truncation.columns,
    rows: input.rows,
    profiles,
    previewRowCount: input.rows.length,
    totalRows: input.totalRows,
    truncated: input.truncated,
    truncation,
    qualityWarnings: buildQualityWarnings(profiles, input.rows, truncation),
    profileScope: 'preview',
    sheet: input.sheet,
    sheets: input.sheets
  };
}

function previewRowLimit(requestedRows: number, columnCount: number): number {
  const cellLimitedRows = Math.max(1, Math.floor(MAX_PREVIEW_CELLS / Math.max(1, columnCount)));
  return Math.min(requestedRows, cellLimitedRows);
}

function validateParquetPreviewSize(
  rowGroups: Array<{
    num_rows: bigint;
    columns: Array<{
      meta_data?: { path_in_schema: string[]; total_uncompressed_size: bigint };
    }>;
  }>,
  selectedColumns: Set<string>,
  rowLimit: number
): void {
  let rowsCovered = 0n;
  let expandedBytes = 0n;
  for (const rowGroup of rowGroups) {
    if (rowsCovered >= BigInt(rowLimit)) break;
    if (rowGroup.num_rows < 0n) {
      throw new Error('Invalid Parquet metadata: negative row-group size.');
    }
    for (const column of rowGroup.columns) {
      const metadata = column.meta_data;
      if (metadata && selectedColumns.has(metadata.path_in_schema[0])) {
        if (metadata.total_uncompressed_size < 0n) {
          throw new Error('Invalid Parquet metadata: negative column size.');
        }
        expandedBytes += metadata.total_uncompressed_size;
        if (expandedBytes > MAX_PARQUET_PREVIEW_EXPANDED_BYTES) {
          throw new Error(
            'Parquet preview exceeds the 256 MB uncompressed safety limit. Reduce dataPeek.maxColumns.'
          );
        }
      }
    }
    rowsCovered += rowGroup.num_rows;
  }
}

function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function clampInteger(
  value: number,
  minimum: number,
  maximum: number,
  fallback: number
): number {
  return Math.floor(clampNumber(value, minimum, maximum, fallback));
}

function clampNumber(
  value: number,
  minimum: number,
  maximum: number,
  fallback: number
): number {
  return Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, value)) : fallback;
}
