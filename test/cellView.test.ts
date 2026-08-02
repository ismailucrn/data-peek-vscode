import assert from 'node:assert/strict';
import test from 'node:test';
import { formatCellDetail, formatCellDisplay } from '../src/cellView';

const testFormatters = {
  number: (value: number): string => `number:${value}`,
  date: (value: Date, includeTime: boolean): string =>
    `${includeTime ? 'datetime' : 'date'}:${value.toISOString()}`
};

test('formats typed table values while preserving unsupported raw text', () => {
  assert.equal(formatCellDisplay(1234567.5, 'number', testFormatters), 'number:1234567.5');
  assert.equal(formatCellDisplay('true', 'boolean', testFormatters), 'True');
  assert.equal(formatCellDisplay(false, 'boolean', testFormatters), 'False');
  assert.equal(
    formatCellDisplay('2024-01-02', 'date', testFormatters),
    'date:2024-01-02T00:00:00.000Z'
  );
  assert.equal(
    formatCellDisplay('2024-01-02T03:04:05Z', 'date', testFormatters),
    'datetime:2024-01-02T03:04:05.000Z'
  );
  assert.equal(formatCellDisplay(null, 'empty', testFormatters), 'NULL');
  assert.equal(formatCellDisplay('00123', 'text', testFormatters), '00123');
  assert.equal(formatCellDisplay('not-a-date', 'date', testFormatters), 'not-a-date');
});

test('formats JSON-like cell values without changing plain text', () => {
  assert.equal(formatCellDetail('{"name":"Ada","active":true}'), '{\n  "name": "Ada",\n  "active": true\n}');
  assert.equal(formatCellDetail('{not json}'), '{not json}');
  assert.equal(formatCellDetail('line one\nline two'), 'line one\nline two');
  assert.equal(formatCellDetail(null), 'null');
});
