import assert from 'node:assert/strict';
import test from 'node:test';
import { copyCellText, copyRowAsTsv } from '../src/clipboard';

test('copies null cells as empty text', () => {
  assert.equal(copyCellText(null), '');
  assert.equal(copyCellText(false), 'false');
});

test('quotes tabs, newlines and quotes in copied TSV rows', () => {
  assert.equal(
    copyRowAsTsv(['a\tb', 'line\nbreak', 'say "hi"', null, true]),
    '"a\tb"\t"line\nbreak"\t"say ""hi"""\t\ttrue'
  );
});
