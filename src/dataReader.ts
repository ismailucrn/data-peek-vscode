import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse';
import ExcelJS from 'exceljs';
import { buildQualityWarnings } from './dataQuality';
import { validateExcelArchive } from './excelArchive';
import {
  defaultDelimitedParsingSettings,
  delimiterCharacter,
  localizedNumber,
  validateDelimitedParsingSettings
} from './parsing';
import {
  StreamingProfileBuilder,
  buildProfiles,
  isTruncatedCell,
  normalizeCell
} from './profile';
import {
  DatasetPreview,
  DelimitedParsingMetadata,
  DelimitedParsingSettings,
  FullProfileOptions,
  FullProfileResult,
  PreviewOptions,
  SerializableCell
} from './types';

const SUPPORTED_EXTENSIONS = new Set(['.csv', '.tsv', '.parquet', '.xlsx', '.xlsm']);
const MAX_CSV_RECORD_BYTES = 2 * 1024 * 1024;
const MAX_PREVIEW_CELLS = 250_000;
const MAX_PARQUET_PREVIEW_EXPANDED_BYTES = 256n * 1024n * 1024n;

interface ProfileScanResult {
  profiles: DatasetPreview['profiles'];
  rowCount: number;
}

export function isSupportedFile(filePath: string): boolean {
  return SUPPORTED_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export async function loadPreview(
  filePath: string,
  options: PreviewOptions
): Promise<DatasetPreview> {
  ensureNotCancelled(options.isCancelled);
  const extension = path.extname(filePath).toLowerCase();
  const stat = await fs.stat(filePath);
  ensureNotCancelled(options.isCancelled);
  const limit = clampInteger(options.limit, 100, 5000, 2000);
  const maxColumns = clampInteger(options.maxColumns, 10, 2000, 500);

  if (!stat.isFile()) {
    throw new Error('The selected resource is not a file.');
  }

  if (extension === '.csv' || extension === '.tsv') {
    const parsingResult = validateDelimitedParsingSettings(
      options.parsing ?? defaultDelimitedParsingSettings()
    );
    if (!parsingResult.value) {
      throw new Error(`Invalid parsing settings: ${parsingResult.error ?? 'unknown error'}`);
    }
    return readDelimited(
      filePath,
      stat.size,
      extension === '.tsv' ? 'TSV' : 'CSV',
      limit,
      maxColumns,
      parsingResult.value,
      options.isCancelled
    );
  }
  if (extension === '.parquet') {
    return readParquet(filePath, stat.size, limit, maxColumns, options.isCancelled);
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
    ensureNotCancelled(options.isCancelled);
    return readExcel(filePath, stat.size, limit, maxColumns, options.sheet, options.isCancelled);
  }

  throw new Error(`Unsupported file type: ${extension || '(no extension)'}`);
}

export async function loadFullProfiles(
  filePath: string,
  options: FullProfileOptions
): Promise<FullProfileResult> {
  ensureNotCancelled(options.isCancelled);
  const extension = path.extname(filePath).toLowerCase();
  const stat = await fs.stat(filePath);
  const maximumScanBytes =
    clampNumber(options.maxProfileScanSizeMB, 64, 8192, 1024) * 1024 * 1024;
  if (!stat.isFile()) throw new Error('The selected resource is not a file.');
  if (stat.size > maximumScanBytes) {
    throw new Error(
      `Full-data profiling is limited to ${formatBytes(maximumScanBytes)}. ` +
      'Increase dataPeek.maxProfileScanSizeMB to scan this file.'
    );
  }

  if (extension === '.csv' || extension === '.tsv') {
    const parsingResult = validateDelimitedParsingSettings(
      options.parsing ?? defaultDelimitedParsingSettings()
    );
    if (!parsingResult.value) {
      throw new Error(`Invalid parsing settings: ${parsingResult.error ?? 'unknown error'}`);
    }
    return completeFullProfile(
      await profileDelimited(
        filePath,
        extension === '.tsv' ? '\t' : ',',
        options.columns,
        parsingResult.value,
        options
      )
    );
  }
  if (extension === '.parquet') {
    return completeFullProfile(
      await profileParquet(filePath, options.columns, maximumScanBytes, options)
    );
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
    return completeFullProfile(await profileExcel(filePath, options.columns, options));
  }
  throw new Error(`Unsupported file type: ${extension || '(no extension)'}`);
}

function completeFullProfile(result: ProfileScanResult): FullProfileResult {
  return {
    ...result,
    qualityWarnings: buildQualityWarnings(result.profiles)
  };
}

async function profileDelimited(
  filePath: string,
  fallbackDelimiter: string,
  columns: string[],
  settings: DelimitedParsingSettings,
  options: FullProfileOptions
): Promise<ProfileScanResult> {
  const detectedDelimiter = await detectDelimiter(
    filePath,
    settings,
    fallbackDelimiter,
    options.isCancelled
  );
  const delimiter =
    delimiterCharacter(settings.delimiter, settings.customDelimiter) ?? detectedDelimiter;
  const input = createReadStream(filePath);
  const parser = input.pipe(
    parse({
      bom: true,
      delimiter,
      encoding: settings.encoding,
      escape: settings.escape,
      from_line: settings.skipRows + 1,
      quote: settings.quote,
      relax_column_count: true,
      relax_quotes: true,
      max_record_size: MAX_CSV_RECORD_BYTES,
      skip_empty_lines: true
    })
  );
  const builder = new StreamingProfileBuilder(columns);
  const nullTokens = new Set(settings.nullTokens);
  let rowCount = 0;
  let firstRecord = true;
  const report = progressReporter(options.onProgress, null);
  try {
    for await (const rawRecord of parser) {
      ensureNotCancelled(options.isCancelled);
      if (firstRecord && settings.header === 'firstNonEmpty') {
        firstRecord = false;
        continue;
      }
      firstRecord = false;
      const values = (rawRecord as unknown[])
        .slice(0, columns.length)
        .map((value) => delimitedCellValue(value, settings, nullTokens));
      builder.addRow(values);
      rowCount += 1;
      if (rowCount % 10_000 === 0) report(rowCount);
    }
  } finally {
    input.destroy();
    parser.destroy();
  }
  report(rowCount, true);
  return { profiles: builder.finish(rowCount), rowCount };
}

async function profileParquet(
  filePath: string,
  columns: string[],
  maximumScanBytes: number,
  options: FullProfileOptions
): Promise<ProfileScanResult> {
  const [{ asyncBufferFromFile, parquetMetadataAsync, parquetRead }, compressorModule] =
    await Promise.all([import('hyparquet'), import('hyparquet-compressors')]);
  ensureNotCancelled(options.isCancelled);
  const file = await asyncBufferFromFile(filePath);
  const metadata = await parquetMetadataAsync(file);
  const totalRowsBigInt = metadata.num_rows;
  if (totalRowsBigInt < 0n || totalRowsBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('The Parquet row count cannot be profiled safely.');
  }
  const rowCount = Number(totalRowsBigInt);
  validateParquetExpandedSize(
    metadata.row_groups,
    new Set(columns),
    rowCount,
    BigInt(maximumScanBytes),
    `Full-data Parquet profiling exceeds the ${formatBytes(maximumScanBytes)} safety limit. ` +
      'Increase dataPeek.maxProfileScanSizeMB or reduce dataPeek.maxColumns.'
  );
  const builder = new StreamingProfileBuilder(columns);
  const columnIndexes = new Map(columns.map((column, index) => [column, index]));
  const columnProgress = new Map(columns.map((column) => [column, 0]));
  const report = progressReporter(options.onProgress, rowCount);
  await parquetRead({
    file,
    metadata,
    columns,
    compressors: compressorModule.compressors,
    onChunk: (chunk: {
      columnName: string;
      columnData: ArrayLike<unknown>;
      rowEnd: number;
    }) => {
      ensureNotCancelled(options.isCancelled);
      const columnIndex = columnIndexes.get(chunk.columnName);
      if (columnIndex === undefined) return;
      builder.addColumnValues(columnIndex, chunk.columnData);
      columnProgress.set(chunk.columnName, Math.max(columnProgress.get(chunk.columnName) ?? 0, chunk.rowEnd));
      const processedRows = Math.min(...columnProgress.values());
      report(processedRows);
    }
  });
  ensureNotCancelled(options.isCancelled);
  report(rowCount, true);
  return { profiles: builder.finish(rowCount), rowCount };
}

async function profileExcel(
  filePath: string,
  columns: string[],
  options: FullProfileOptions
): Promise<ProfileScanResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  ensureNotCancelled(options.isCancelled);
  const worksheet =
    (options.sheet ? workbook.getWorksheet(options.sheet) : undefined) ?? workbook.worksheets[0];
  if (!worksheet) throw new Error('The workbook does not contain a worksheet.');
  const builder = new StreamingProfileBuilder(columns);
  let rowCount = 0;
  let headerRowNumber = 1;
  while (
    headerRowNumber <= worksheet.actualRowCount &&
    !worksheet.getRow(headerRowNumber).hasValues
  ) {
    headerRowNumber += 1;
  }
  const possibleRows = Math.max(0, worksheet.actualRowCount - headerRowNumber);
  const report = progressReporter(options.onProgress, possibleRows);
  for (
    let rowNumber = headerRowNumber + 1;
    rowNumber <= worksheet.actualRowCount;
    rowNumber += 1
  ) {
    ensureNotCancelled(options.isCancelled);
    const row = worksheet.getRow(rowNumber);
    const values = columns.map((_column, index) => excelCellValue(row.getCell(index + 1)));
    if (values.every((value) => value === null)) continue;
    builder.addRow(values);
    rowCount += 1;
    if (rowNumber % 1_000 === 0) {
      report(Math.min(possibleRows, rowNumber - headerRowNumber));
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
  report(possibleRows, true);
  return { profiles: builder.finish(rowCount), rowCount };
}

function progressReporter(
  onProgress: FullProfileOptions['onProgress'],
  totalRows: number | null
): (processedRows: number, force?: boolean) => void {
  let lastReported = -1;
  let lastTime = 0;
  return (processedRows, force = false) => {
    const now = Date.now();
    if (!force && processedRows === lastReported) return;
    if (!force && now - lastTime < 150) return;
    lastReported = processedRows;
    lastTime = now;
    onProgress?.(processedRows, totalRows);
  };
}

async function readDelimited(
  filePath: string,
  fileSize: number,
  format: 'CSV' | 'TSV',
  limit: number,
  maxColumns: number,
  settings: DelimitedParsingSettings,
  isCancelled?: () => boolean
): Promise<DatasetPreview> {
  const detectedDelimiter = await detectDelimiter(
    filePath,
    settings,
    format === 'TSV' ? '\t' : ',',
    isCancelled
  );
  ensureNotCancelled(isCancelled);
  const delimiter =
    delimiterCharacter(settings.delimiter, settings.customDelimiter) ?? detectedDelimiter;
  const input = createReadStream(filePath);
  const parser = input.pipe(
    parse({
      bom: true,
      delimiter,
      encoding: settings.encoding,
      escape: settings.escape,
      from_line: settings.skipRows + 1,
      quote: settings.quote,
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
  const nullTokens = new Set(settings.nullTokens);

  try {
    for await (const rawRecord of parser) {
      ensureNotCancelled(isCancelled);
      const rawValues = rawRecord as unknown[];
      totalColumns = Math.max(totalColumns, rawValues.length);
      const rawRecordValues = rawValues.slice(0, maxColumns).map(normalizeCell);
      if (columns.length === 0) {
        columns =
          settings.header === 'firstNonEmpty'
            ? uniqueHeaders(rawRecordValues)
            : Array.from(
                { length: rawRecordValues.length },
                (_unused, index) => `column_${index + 1}`
              );
        effectiveLimit = previewRowLimit(limit, columns.length);
        if (settings.header === 'firstNonEmpty') continue;
      }
      const record = rawValues
        .slice(0, maxColumns)
        .map((value) => delimitedCellValue(value, settings, nullTokens));
      ensureColumns(columns, Math.min(record.length, maxColumns));
      effectiveLimit = previewRowLimit(limit, columns.length);
      if (rows.length >= effectiveLimit) {
        if (rows.length > effectiveLimit) rows.length = effectiveLimit;
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
    format,
    fileSize,
    columns,
    totalColumns,
    rows,
    totalRows: sawExtraRow ? null : rows.length,
    truncated: sawExtraRow,
    parsing: {
      detectedDelimiter,
      resolvedDelimiter: delimiter,
      applied: settings
    }
  });
}

async function readParquet(
  filePath: string,
  fileSize: number,
  limit: number,
  maxColumns: number,
  isCancelled?: () => boolean
): Promise<DatasetPreview> {
  const [{ asyncBufferFromFile, parquetMetadataAsync, parquetRead, parquetSchema }, compressorModule] =
    await Promise.all([import('hyparquet'), import('hyparquet-compressors')]);
  ensureNotCancelled(isCancelled);
  const file = await asyncBufferFromFile(filePath);
  const metadata = await parquetMetadataAsync(file);
  ensureNotCancelled(isCancelled);
  const totalRowsBigInt = metadata.num_rows;
  if (totalRowsBigInt < 0n) {
    throw new Error('Invalid Parquet metadata: negative row count.');
  }
  const totalRows =
    totalRowsBigInt <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(totalRowsBigInt) : null;
  const allColumns = parquetSchema(metadata).children.map((child) => child.element.name);
  const columns = allColumns.slice(0, maxColumns);
  const effectiveLimit = previewRowLimit(limit, columns.length);
  validateParquetExpandedSize(
    metadata.row_groups,
    new Set(columns),
    effectiveLimit,
    MAX_PARQUET_PREVIEW_EXPANDED_BYTES,
    'Parquet preview exceeds the 256 MB uncompressed safety limit. Reduce dataPeek.maxColumns.'
  );
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
  ensureNotCancelled(isCancelled);
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
  requestedSheet?: string,
  isCancelled?: () => boolean
): Promise<DatasetPreview> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  ensureNotCancelled(isCancelled);
  const sheets = workbook.worksheets.map((worksheet) => worksheet.name);
  const worksheet =
    (requestedSheet ? workbook.getWorksheet(requestedSheet) : undefined) ?? workbook.worksheets[0];

  if (!worksheet) {
    throw new Error('The workbook does not contain a worksheet.');
  }

  const totalColumns = worksheet.columnCount;
  let columns: string[] | undefined;
  const rows: SerializableCell[][] = [];
  let effectiveLimit = limit;
  let sawExtraRow = false;

  worksheet.eachRow((row) => {
    ensureNotCancelled(isCancelled);
    if (!columns) {
      const width = Math.min(Math.max(totalColumns, row.cellCount), maxColumns);
      columns = uniqueHeaders(
        Array.from({ length: width }, (_, index) => excelCellValue(row.getCell(index + 1)))
      );
      effectiveLimit = previewRowLimit(limit, columns.length);
      return;
    }
    if (sawExtraRow) return;
    const values = columns.map((_column, index) => excelCellValue(row.getCell(index + 1)));
    if (values.every((value) => value === null)) return;
    if (rows.length >= effectiveLimit) {
      sawExtraRow = true;
      return;
    }
    rows.push(values);
  });

  if (!columns) {
    return makePreview({
      filePath,
      format: 'EXCEL',
      fileSize,
      columns: [],
      totalColumns,
      rows,
      totalRows: 0,
      truncated: false,
      sheet: worksheet.name,
      sheets
    });
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

async function detectDelimiter(
  filePath: string,
  settings: DelimitedParsingSettings,
  fallback: string,
  isCancelled?: () => boolean
): Promise<string> {
  ensureNotCancelled(isCancelled);
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(64 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    ensureNotCancelled(isCancelled);
    const sample = buffer
      .subarray(0, bytesRead)
      .toString(settings.encoding)
      .split(/\r?\n/)
      .slice(settings.skipRows, settings.skipRows + 5)
      .join('\n');
    const candidates = [',', ';', '\t', '|'].filter((candidate) => candidate !== settings.quote);
    return candidates
      .map((delimiter) => ({
        delimiter,
        count: countOutsideQuotes(sample, delimiter, settings.quote, settings.escape)
      }))
      .sort((left, right) => right.count - left.count)
      .find((candidate) => candidate.count > 0)?.delimiter ?? fallback;
  } finally {
    await handle.close();
  }
}

function countOutsideQuotes(
  text: string,
  delimiter: string,
  quote: string,
  escape: string
): number {
  let inQuotes = false;
  let count = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === quote) {
      if (inQuotes && text[index - 1] === escape) {
        continue;
      }
      if (inQuotes && quote === escape && text[index + 1] === quote) {
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

function delimitedCellValue(
  value: unknown,
  settings: DelimitedParsingSettings,
  nullTokens: ReadonlySet<string>
): SerializableCell {
  if (typeof value !== 'string') return normalizeCell(value);
  if (nullTokens.has(value)) return null;
  const numeric = localizedNumber(
    value,
    settings.decimalSeparator,
    settings.thousandsSeparator
  );
  return numeric ?? normalizeCell(value);
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
  parsing?: DelimitedParsingMetadata;
}): DatasetPreview {
  const profiles = buildProfiles(input.columns, input.rows);
  const profileScope = input.truncated ? 'preview' : 'full';
  const totalColumns = input.totalColumns ?? input.columns.length;
  const truncation = {
    rows: input.truncated,
    columns: totalColumns > input.columns.length,
    cells: countTruncatedCells(input.rows)
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
    qualityWarnings: profileScope === 'full' ? buildQualityWarnings(profiles) : [],
    profileScope,
    profiledRowCount: input.rows.length,
    parsing: input.parsing,
    sheet: input.sheet,
    sheets: input.sheets
  };
}

function countTruncatedCells(rows: SerializableCell[][]): number {
  let count = 0;
  for (const row of rows) {
    for (const value of row) {
      if (isTruncatedCell(value)) count += 1;
    }
  }
  return count;
}

function previewRowLimit(requestedRows: number, columnCount: number): number {
  const cellLimitedRows = Math.max(1, Math.floor(MAX_PREVIEW_CELLS / Math.max(1, columnCount)));
  return Math.min(requestedRows, cellLimitedRows);
}

function validateParquetExpandedSize(
  rowGroups: Array<{
    num_rows: bigint;
    columns: Array<{
      meta_data?: { path_in_schema: string[]; total_uncompressed_size: bigint };
    }>;
  }>,
  selectedColumns: Set<string>,
  rowLimit: number,
  maximumBytes: bigint,
  errorMessage: string
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
        if (expandedBytes > maximumBytes) throw new Error(errorMessage);
      }
    }
    rowsCovered += rowGroup.num_rows;
  }
}

function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ensureNotCancelled(isCancelled: (() => boolean) | undefined): void {
  if (isCancelled?.()) throw new Error('Preview loading was cancelled.');
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
