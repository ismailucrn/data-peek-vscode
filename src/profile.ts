import { ColumnProfile, SerializableCell } from './types';

const MAX_CELL_CHARACTERS = 100_000;
const TRUNCATION_SUFFIX = '… [truncated]';
const VALUE_KEY_COLLATOR = new Intl.Collator('en');

export function normalizeCell(value: unknown): SerializableCell {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value === 'string' || typeof value === 'boolean') {
    return typeof value === 'string' ? truncateText(value) : value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : String(value);
  }
  if (typeof value === 'bigint') {
    const numeric = Number(value);
    return Number.isSafeInteger(numeric) ? numeric : value.toString();
  }
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : String(value);
  }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return `[binary: ${value.byteLength} bytes]`;
  }

  try {
    const serialized = JSON.stringify(value, (_key, nested) =>
      typeof nested === 'bigint' ? nested.toString() : nested
    );
    return typeof serialized === 'string'
      ? truncateText(serialized)
      : truncateText(safeString(value));
  } catch {
    return truncateText(safeString(value));
  }
}

function safeString(value: unknown): string {
  try {
    return String(value);
  } catch {
    return '[unrepresentable value]';
  }
}

function truncateText(value: string): string {
  if (value.length <= MAX_CELL_CHARACTERS) {
    return value;
  }
  return `${value.slice(0, MAX_CELL_CHARACTERS - TRUNCATION_SUFFIX.length)}${TRUNCATION_SUFFIX}`;
}

export function isTruncatedCell(value: SerializableCell): boolean {
  return (
    typeof value === 'string' &&
    value.length === MAX_CELL_CHARACTERS &&
    value.endsWith(TRUNCATION_SUFFIX)
  );
}

function valueType(value: SerializableCell): ColumnProfile['type'] {
  if (value === null) {
    return 'empty';
  }
  if (typeof value === 'number') {
    return 'number';
  }
  if (typeof value === 'boolean') {
    return 'boolean';
  }
  const trimmed = value.trim();
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed)) {
    return 'number';
  }
  if (/^(true|false)$/i.test(trimmed)) {
    return 'boolean';
  }
  if (
    /^\d{4}-\d{2}-\d{2}(?:[T\s].*)?$/.test(trimmed) &&
    Number.isFinite(Date.parse(trimmed))
  ) {
    return 'date';
  }
  return 'text';
}

export function buildProfiles(
  columns: string[],
  rows: SerializableCell[][]
): ColumnProfile[] {
  return columns.map((name, columnIndex) => {
    const values = rows.map((row) => row[columnIndex] ?? null);
    const present = values.filter((value) => value !== null);
    const types = new Set(present.map(valueType));
    const type: ColumnProfile['type'] =
      present.length === 0 ? 'empty' : types.size === 1 ? [...types][0] : 'mixed';
    const valueSummary = summarizeValues(present);
    const profile: ColumnProfile = {
      name,
      type,
      missing: values.length - present.length,
      nonNull: present.length,
      distinct: valueSummary.distinct,
      missingRatio: values.length === 0 ? 0 : (values.length - present.length) / values.length,
      uniqueRatio: present.length === 0 ? 0 : valueSummary.distinct / present.length,
      topValues: valueSummary.topValues
    };

    if (type === 'number') {
      const numeric = present.map(Number).filter(Number.isFinite);
      if (numeric.length > 0) {
        profile.min = Math.min(...numeric);
        profile.max = Math.max(...numeric);
        profile.mean = numeric.reduce((sum, value) => sum + value, 0) / numeric.length;
        const sorted = [...numeric].sort((left, right) => left - right);
        const midpoint = Math.floor(sorted.length / 2);
        profile.median =
          sorted.length % 2 === 0
            ? (sorted[midpoint - 1] + sorted[midpoint]) / 2
            : sorted[midpoint];
        profile.standardDeviation = Math.sqrt(
          numeric.reduce((sum, value) => sum + (value - profile.mean!) ** 2, 0) /
            numeric.length
        );
        profile.histogram = buildHistogram(numeric);
      }
    } else if (type === 'date') {
      const sorted = present
        .map(String)
        .sort((left, right) => Date.parse(left) - Date.parse(right));
      profile.min = sorted[0];
      profile.max = sorted[sorted.length - 1];
    } else if (type === 'text') {
      const lengths = present.map((value) => String(value).length);
      profile.minLength = Math.min(...lengths);
      profile.maxLength = Math.max(...lengths);
    }
    return profile;
  });
}

function summarizeValues(values: SerializableCell[]): {
  distinct: number;
  topValues: ColumnProfile['topValues'];
} {
  const frequencies = new Map<string, { value: SerializableCell; count: number; key: string }>();
  for (const value of values) {
    const key = `${typeof value}:${String(value)}`;
    const existing = frequencies.get(key);
    if (existing) existing.count += 1;
    else frequencies.set(key, { value, count: 1, key });
  }
  const top: Array<{ value: SerializableCell; count: number; key: string }> = [];
  for (const frequency of frequencies.values()) {
    const position = top.findIndex((candidate) => compareFrequency(frequency, candidate) < 0);
    if (position >= 0) top.splice(position, 0, frequency);
    else if (top.length < 5) top.push(frequency);
    if (top.length > 5) top.pop();
  }
  return {
    distinct: frequencies.size,
    topValues: top.map(({ value, count }) => ({ value, count }))
  };
}

function compareFrequency(
  left: { count: number; key: string },
  right: { count: number; key: string }
): number {
  return right.count - left.count || VALUE_KEY_COLLATOR.compare(left.key, right.key);
}

function buildHistogram(values: number[]): NonNullable<ColumnProfile['histogram']> {
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  if (minimum === maximum) return [{ start: minimum, end: maximum, count: values.length }];
  const binCount = Math.min(12, Math.max(1, Math.ceil(Math.sqrt(values.length))));
  const width = (maximum - minimum) / binCount;
  const bins = Array.from({ length: binCount }, (_, index) => ({
    start: minimum + width * index,
    end: index === binCount - 1 ? maximum : minimum + width * (index + 1),
    count: 0
  }));
  for (const value of values) {
    const index = value === maximum ? binCount - 1 : Math.floor((value - minimum) / width);
    bins[index].count += 1;
  }
  return bins;
}
