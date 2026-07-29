import { ColumnProfile, SerializableCell } from './types';

const MAX_CELL_CHARACTERS = 100_000;
const TRUNCATION_SUFFIX = '… [truncated]';
const VALUE_KEY_COLLATOR = new Intl.Collator('en');
const MAX_EXACT_FREQUENCIES_PER_COLUMN = 512;
const MAX_EXACT_FREQUENCIES_TOTAL = 32_768;
const TOP_VALUE_CANDIDATES = 32;
const PROFILE_SAMPLE_SIZE = 512;
const PROFILE_VALUE_CHARACTERS = 512;
const HLL_REGISTER_COUNT = 256;
const COUNT_MIN_WIDTH = 256;
const COUNT_MIN_DEPTH = 4;

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

export class StreamingProfileBuilder {
  private readonly columns: StreamingColumnProfile[];
  private rowCount = 0;

  constructor(columnNames: string[]) {
    const exactFrequencyLimit = Math.max(
      32,
      Math.min(
        MAX_EXACT_FREQUENCIES_PER_COLUMN,
        Math.floor(MAX_EXACT_FREQUENCIES_TOTAL / Math.max(1, columnNames.length))
      )
    );
    this.columns = columnNames.map(
      (name) => new StreamingColumnProfile(name, exactFrequencyLimit)
    );
  }

  addRow(row: readonly unknown[]): void {
    this.rowCount += 1;
    for (let columnIndex = 0; columnIndex < this.columns.length; columnIndex += 1) {
      this.columns[columnIndex].add(normalizeCell(row[columnIndex]));
    }
  }

  addColumnValues(columnIndex: number, values: ArrayLike<unknown>): void {
    const column = this.columns[columnIndex];
    if (!column) return;
    for (let index = 0; index < values.length; index += 1) {
      column.add(normalizeCell(values[index]));
    }
  }

  finish(rowCount = this.rowCount): ColumnProfile[] {
    return this.columns.map((column) => column.finish(rowCount));
  }
}

class StreamingColumnProfile {
  private nonNull = 0;
  private readonly types = new Set<ColumnProfile['type']>();
  private numericCount = 0;
  private numericMean = 0;
  private numericM2 = 0;
  private numericMin = Infinity;
  private numericMax = -Infinity;
  private readonly numericSample: number[] = [];
  private dateMin: string | undefined;
  private dateMax: string | undefined;
  private minLength = Infinity;
  private maxLength = 0;
  private exactFrequencies:
    | Map<string, { value: SerializableCell; count: number; hash: number }>
    | undefined = new Map();
  private readonly distinctSketch = new Uint8Array(HLL_REGISTER_COUNT);
  private readonly frequencySketch = Array.from(
    { length: COUNT_MIN_DEPTH },
    () => new Uint32Array(COUNT_MIN_WIDTH)
  );
  private readonly topCandidates = new Map<
    string,
    { value: SerializableCell; count: number; hash: number }
  >();

  constructor(
    private readonly name: string,
    private readonly exactFrequencyLimit: number
  ) {}

  add(value: SerializableCell): void {
    if (value === null) return;
    this.nonNull += 1;
    const type = valueType(value);
    this.types.add(type);
    this.addFrequency(value);

    if (type === 'number') {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return;
      this.numericCount += 1;
      this.numericMin = Math.min(this.numericMin, numeric);
      this.numericMax = Math.max(this.numericMax, numeric);
      const delta = numeric - this.numericMean;
      this.numericMean += delta / this.numericCount;
      this.numericM2 += delta * (numeric - this.numericMean);
      this.addNumericSample(numeric);
    } else if (type === 'date') {
      const text = String(value);
      if (!this.dateMin || Date.parse(text) < Date.parse(this.dateMin)) this.dateMin = text;
      if (!this.dateMax || Date.parse(text) > Date.parse(this.dateMax)) this.dateMax = text;
    } else if (type === 'text') {
      const length = String(value).length;
      this.minLength = Math.min(this.minLength, length);
      this.maxLength = Math.max(this.maxLength, length);
    }
  }

  finish(rowCount: number): ColumnProfile {
    const type: ColumnProfile['type'] =
      this.nonNull === 0 ? 'empty' : this.types.size === 1 ? [...this.types][0] : 'mixed';
    const frequencies = this.frequencySummary();
    const approximateMetrics: NonNullable<ColumnProfile['approximateMetrics']> = [];
    if (!this.exactFrequencies) approximateMetrics.push('distinct', 'topValues');
    const profile: ColumnProfile = {
      name: this.name,
      type,
      missing: Math.max(0, rowCount - this.nonNull),
      nonNull: this.nonNull,
      distinct: frequencies.distinct,
      missingRatio: rowCount === 0 ? 0 : Math.max(0, rowCount - this.nonNull) / rowCount,
      uniqueRatio: this.nonNull === 0 ? 0 : frequencies.distinct / this.nonNull,
      topValues: frequencies.topValues
    };

    if (type === 'number' && this.numericCount > 0) {
      const sorted = [...this.numericSample].sort((left, right) => left - right);
      const midpoint = Math.floor(sorted.length / 2);
      profile.min = this.numericMin;
      profile.max = this.numericMax;
      profile.mean = this.numericMean;
      profile.median =
        sorted.length % 2 === 0
          ? (sorted[midpoint - 1] + sorted[midpoint]) / 2
          : sorted[midpoint];
      profile.standardDeviation = Math.sqrt(this.numericM2 / this.numericCount);
      profile.histogram = sampledHistogram(
        sorted,
        this.numericMin,
        this.numericMax,
        this.numericCount
      );
      if (this.numericCount > this.numericSample.length) {
        approximateMetrics.push('median', 'histogram');
      }
    } else if (type === 'date') {
      profile.min = this.dateMin;
      profile.max = this.dateMax;
    } else if (type === 'text') {
      profile.minLength = Number.isFinite(this.minLength) ? this.minLength : 0;
      profile.maxLength = this.maxLength;
    }
    if (approximateMetrics.length > 0) profile.approximateMetrics = approximateMetrics;
    return profile;
  }

  private addNumericSample(value: number): void {
    if (this.numericSample.length < PROFILE_SAMPLE_SIZE) {
      this.numericSample.push(value);
      return;
    }
    const replacement = mix32(Math.imul(this.numericCount, 0x9e3779b1)) % this.numericCount;
    if (replacement < PROFILE_SAMPLE_SIZE) this.numericSample[replacement] = value;
  }

  private addFrequency(value: SerializableCell): void {
    const text = `${typeof value}:${String(value)}`;
    const [hash, secondaryHash] = hashTextPair(text);
    const key = `${hash}:${secondaryHash}`;
    const displayValue = profileDisplayValue(value);
    const exact = this.exactFrequencies;
    if (exact) {
      const existing = exact.get(key);
      if (existing) {
        existing.count += 1;
        return;
      }
      if (exact.size < this.exactFrequencyLimit) {
        exact.set(key, { value: displayValue, count: 1, hash });
        return;
      }
      for (const [candidateKey, frequency] of exact) {
        this.addToSketch(candidateKey, frequency.value, frequency.hash, frequency.count);
      }
      this.exactFrequencies = undefined;
    }
    this.addToSketch(key, displayValue, hash, 1);
  }

  private addToSketch(
    key: string,
    value: SerializableCell,
    hash: number,
    increment: number
  ): void {
    addHyperLogLog(this.distinctSketch, hash);
    let estimate = Number.MAX_SAFE_INTEGER;
    for (let depth = 0; depth < COUNT_MIN_DEPTH; depth += 1) {
      const index = mix32(hash + depth * 0x9e3779b1) % COUNT_MIN_WIDTH;
      const next = Math.min(0xffffffff, this.frequencySketch[depth][index] + increment);
      this.frequencySketch[depth][index] = next;
      estimate = Math.min(estimate, next);
    }
    const existing = this.topCandidates.get(key);
    if (existing) {
      existing.count = estimate;
      return;
    }
    if (this.topCandidates.size < TOP_VALUE_CANDIDATES) {
      this.topCandidates.set(key, { value, count: estimate, hash });
      return;
    }
    let smallestKey: string | undefined;
    let smallestCount = Infinity;
    for (const [candidateKey, candidate] of this.topCandidates) {
      if (candidate.count < smallestCount) {
        smallestKey = candidateKey;
        smallestCount = candidate.count;
      }
    }
    if (smallestKey && estimate > smallestCount) {
      this.topCandidates.delete(smallestKey);
      this.topCandidates.set(key, { value, count: estimate, hash });
    }
  }

  private frequencySummary(): {
    distinct: number;
    topValues: ColumnProfile['topValues'];
  } {
    const values = this.exactFrequencies
      ? [...this.exactFrequencies.values()]
      : [...this.topCandidates.values()];
    values.sort((left, right) =>
      right.count - left.count ||
      VALUE_KEY_COLLATOR.compare(String(left.value), String(right.value))
    );
    return {
      distinct: this.exactFrequencies
        ? this.exactFrequencies.size
        : Math.min(this.nonNull, estimateHyperLogLog(this.distinctSketch)),
      topValues: values.slice(0, 5).map(({ value, count }) => ({ value, count }))
    };
  }
}

function profileDisplayValue(value: SerializableCell): SerializableCell {
  if (typeof value !== 'string' || value.length <= PROFILE_VALUE_CHARACTERS) return value;
  return `${value.slice(0, PROFILE_VALUE_CHARACTERS - TRUNCATION_SUFFIX.length)}${TRUNCATION_SUFFIX}`;
}

function hashTextPair(value: string): [number, number] {
  let first = 0x811c9dc5;
  let second = 0x85ebca6b;
  for (let index = 0; index < value.length; index += 1) {
    const character = value.charCodeAt(index);
    first = Math.imul(first ^ character, 0x01000193);
    second = Math.imul(second ^ character, 0x27d4eb2d);
  }
  return [mix32(first), mix32(second)];
}

function mix32(value: number): number {
  let mixed = value >>> 0;
  mixed ^= mixed >>> 16;
  mixed = Math.imul(mixed, 0x7feb352d);
  mixed ^= mixed >>> 15;
  mixed = Math.imul(mixed, 0x846ca68b);
  return (mixed ^ (mixed >>> 16)) >>> 0;
}

function addHyperLogLog(registers: Uint8Array, hash: number): void {
  const index = hash & (HLL_REGISTER_COUNT - 1);
  const remainder = hash >>> 8;
  const rank = remainder === 0 ? 25 : Math.clz32(remainder) - 7;
  registers[index] = Math.max(registers[index], rank);
}

function estimateHyperLogLog(registers: Uint8Array): number {
  let denominator = 0;
  let zeroes = 0;
  for (const register of registers) {
    denominator += 2 ** -register;
    if (register === 0) zeroes += 1;
  }
  const estimate = (0.718272593 * registers.length * registers.length) / denominator;
  const corrected =
    estimate <= 2.5 * registers.length && zeroes > 0
      ? registers.length * Math.log(registers.length / zeroes)
      : estimate;
  return Math.max(0, Math.round(corrected));
}

function sampledHistogram(
  sortedSample: number[],
  minimum: number,
  maximum: number,
  totalCount: number
): NonNullable<ColumnProfile['histogram']> {
  if (minimum === maximum) return [{ start: minimum, end: maximum, count: totalCount }];
  const binCount = Math.min(12, Math.max(1, Math.ceil(Math.sqrt(sortedSample.length))));
  const width = (maximum - minimum) / binCount;
  const bins = Array.from({ length: binCount }, (_, index) => ({
    start: minimum + width * index,
    end: index === binCount - 1 ? maximum : minimum + width * (index + 1),
    count: 0
  }));
  for (const value of sortedSample) {
    const index = value === maximum
      ? binCount - 1
      : Math.max(0, Math.min(binCount - 1, Math.floor((value - minimum) / width)));
    bins[index].count += 1;
  }
  let assigned = 0;
  for (let index = 0; index < bins.length; index += 1) {
    const scaled =
      index === bins.length - 1
        ? totalCount - assigned
        : Math.floor((bins[index].count / sortedSample.length) * totalCount);
    bins[index].count = Math.max(0, scaled);
    assigned += bins[index].count;
  }
  return bins;
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
