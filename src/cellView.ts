import { ColumnProfile, SerializableCell } from './types';

export interface CellDisplayFormatters {
  number: (value: number) => string;
  date: (value: Date, includeTime: boolean) => string;
}

const NUMBER_FORMATTER = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 20
});
const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  timeZone: 'UTC'
});
const DATE_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  timeZone: 'UTC',
  timeZoneName: 'short'
});
const DEFAULT_DISPLAY_FORMATTERS: CellDisplayFormatters = {
  number: (value) => NUMBER_FORMATTER.format(value),
  date: (value, includeTime) =>
    (includeTime ? DATE_TIME_FORMATTER : DATE_FORMATTER).format(value)
};

export function formatCellDisplay(
  value: SerializableCell,
  type: ColumnProfile['type'],
  formatters: CellDisplayFormatters = DEFAULT_DISPLAY_FORMATTERS
): string {
  if (value === null) return 'NULL';
  const raw = String(value);
  if (type === 'number') {
    const numeric = typeof value === 'number' ? value : Number(raw);
    if (Number.isFinite(numeric) && raw.trim().length > 0) return formatters.number(numeric);
  }
  if (type === 'boolean') {
    const normalized = raw.trim().toLowerCase();
    if (normalized === 'true') return 'True';
    if (normalized === 'false') return 'False';
  }
  if (type === 'date') {
    const timestamp = Date.parse(raw);
    if (Number.isFinite(timestamp)) {
      return formatters.date(new Date(timestamp), /T|\d{1,2}:\d{2}/.test(raw));
    }
  }
  return raw;
}

export function formatCellDetail(value: SerializableCell): string {
  if (value === null) return 'null';
  if (typeof value !== 'string') return String(value);
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      return value;
    }
  }
  return value;
}
