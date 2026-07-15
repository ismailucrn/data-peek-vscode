import { ColumnProfile, SerializableCell } from './types';

const MAX_CELL_CHARACTERS = 100_000;

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
    return value.toISOString();
  }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return `[binary: ${value.byteLength} bytes]`;
  }

  try {
    return truncateText(
      JSON.stringify(value, (_key, nested) =>
        typeof nested === 'bigint' ? nested.toString() : nested
      )
    );
  } catch {
    return truncateText(String(value));
  }
}

function truncateText(value: string): string {
  if (value.length <= MAX_CELL_CHARACTERS) {
    return value;
  }
  return `${value.slice(0, MAX_CELL_CHARACTERS)}… [truncated]`;
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
    const distinct = new Set(present.map((value) => `${typeof value}:${String(value)}`)).size;
    const profile: ColumnProfile = {
      name,
      type,
      missing: values.length - present.length,
      nonNull: present.length,
      distinct
    };

    if (type === 'number') {
      const numeric = present.map(Number).filter(Number.isFinite);
      if (numeric.length > 0) {
        profile.min = Math.min(...numeric);
        profile.max = Math.max(...numeric);
        profile.mean = numeric.reduce((sum, value) => sum + value, 0) / numeric.length;
      }
    } else if (type === 'date') {
      const sorted = present.map(String).sort();
      profile.min = sorted[0];
      profile.max = sorted[sorted.length - 1];
    }
    return profile;
  });
}
