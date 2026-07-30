import assert from 'node:assert/strict';
import test from 'node:test';
import { buildQualityWarnings } from '../src/dataQuality';
import {
  StreamingProfileBuilder,
  buildProfiles,
  isTruncatedCell,
  normalizeCell
} from '../src/profile';
import { SerializableCell } from '../src/types';

test('builds deterministic numeric distributions from preview values', () => {
  const [profile] = buildProfiles(['score'], [[1], [2], [3], [4], [null]]);
  assert.equal(profile.mean, 2.5);
  assert.equal(profile.median, 2.5);
  assert.equal(profile.standardDeviation, Math.sqrt(1.25));
  assert.deepEqual(profile.histogram, [
    { start: 1, end: 2.5, count: 2 },
    { start: 2.5, end: 4, count: 2 }
  ]);
  assert.equal(profile.missingRatio, 0.2);
  assert.equal(profile.uniqueRatio, 1);
});

test('uses one histogram bin for constant numeric columns', () => {
  const [profile] = buildProfiles(['constant'], [[7], [7], [7]]);
  assert.deepEqual(profile.histogram, [{ start: 7, end: 7, count: 3 }]);
  assert.equal(profile.standardDeviation, 0);
});

test('caps histograms at twelve bins and top values at five entries', () => {
  const rows = Array.from({ length: 200 }, (_, index) => [index, `value-${index}`]);
  const [numeric, text] = buildProfiles(['numeric', 'text'], rows);
  assert.equal(numeric.histogram?.length, 12);
  assert.equal(text.topValues.length, 5);
});

test('keeps deterministic top values without sorting every distinct value', () => {
  const [profile] = buildProfiles(
    ['value'],
    ['z', 'a', 'm', 'a', 'z', 'b', 'c', 'd'].map((value) => [value])
  );
  assert.deepEqual(profile.topValues, [
    { value: 'a', count: 2 },
    { value: 'z', count: 2 },
    { value: 'b', count: 1 },
    { value: 'c', count: 1 },
    { value: 'd', count: 1 }
  ]);
});

test('recognizes only safety-limited values as truncated cells', () => {
  assert.equal(isTruncatedCell('user text … [truncated]'), false);
  assert.equal(isTruncatedCell(normalizeCell('x'.repeat(100_001))), true);
});

test('profiles text lengths, top values and chronological date ranges', () => {
  const profiles = buildProfiles(
    ['label', 'date'],
    [
      ['longer', '2024-12-01'],
      ['x', '2023-01-15'],
      ['x', '2024-01-01']
    ]
  );
  assert.equal(profiles[0].minLength, 1);
  assert.equal(profiles[0].maxLength, 6);
  assert.deepEqual(profiles[0].topValues[0], { value: 'x', count: 2 });
  assert.equal(profiles[1].min, '2023-01-15');
  assert.equal(profiles[1].max, '2024-12-01');
});

test('streams full-data profiles with exact bounded metrics and marked estimates', () => {
  const builder = new StreamingProfileBuilder(['value', 'group']);
  for (let index = 0; index < 2_000; index += 1) {
    builder.addRow([index, index < 1_500 ? 'early' : 'late']);
  }
  const [numeric, group] = builder.finish(2_000);
  assert.equal(numeric.nonNull, 2_000);
  assert.equal(numeric.min, 0);
  assert.equal(numeric.max, 1_999);
  assert.equal(numeric.mean, 999.5);
  assert.ok(Math.abs(numeric.distinct - 2_000) < 300);
  assert.deepEqual(
    new Set(numeric.approximateMetrics),
    new Set(['distinct', 'topValues', 'median', 'histogram'])
  );
  assert.equal(
    numeric.histogram?.reduce((total, bin) => total + bin.count, 0),
    2_000
  );
  assert.equal(group.distinct, 2);
  assert.equal(group.topValues[0]?.value, 'early');
  assert.equal(group.topValues[0]?.count, 1_500);
  assert.equal(group.approximateMetrics, undefined);
});

test('creates full-data quality warnings from column profiles', () => {
  const rows: SerializableCell[][] = Array.from({ length: 50 }, (_, index) => [
    `id-${index}`,
    index === 0 ? 'text' : index,
    null,
    index < 15 ? null : 'same'
  ]);
  rows.push([...rows[0]]);
  const profiles = buildProfiles(['id', 'mixed', 'empty', 'missing'], rows);
  const warnings = buildQualityWarnings(profiles);
  const codes = new Set(warnings.map((warning) => warning.code));
  assert.deepEqual(
    [...codes].sort(),
    [
      'allEmpty',
      'constant',
      'highMissing',
      'mixedType',
      'possibleIdentifier'
    ].sort()
  );
  assert.equal(warnings.some((warning) => warning.message.includes('preview')), false);
});
