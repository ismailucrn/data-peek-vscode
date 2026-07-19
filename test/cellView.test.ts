import assert from 'node:assert/strict';
import test from 'node:test';
import { formatCellDetail } from '../src/cellView';

test('formats JSON-like cell values without changing plain text', () => {
  assert.equal(formatCellDetail('{"name":"Ada","active":true}'), '{\n  "name": "Ada",\n  "active": true\n}');
  assert.equal(formatCellDetail('{not json}'), '{not json}');
  assert.equal(formatCellDetail('line one\nline two'), 'line one\nline two');
  assert.equal(formatCellDetail(null), 'null');
});
