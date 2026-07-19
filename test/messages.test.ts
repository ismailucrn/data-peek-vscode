import assert from 'node:assert/strict';
import test from 'node:test';
import { isWebviewMessage } from '../src/messages';

test('accepts bounded clipboard requests with preview indexes', () => {
  assert.equal(
    isWebviewMessage({ type: 'copy', kind: 'cell', rowIndex: 12, columnIndex: 4 }),
    true
  );
  assert.equal(isWebviewMessage({ type: 'updateParsing', settings: null }), true);
  assert.equal(
    isWebviewMessage({
      type: 'updateParsing',
      settings: {
        delimiter: 'auto',
        encoding: 'utf8',
        header: 'firstNonEmpty',
        skipRows: 0,
        quote: '"',
        escape: '"',
        nullTokens: ['NA'],
        decimalSeparator: 'dot',
        thousandsSeparator: 'none'
      }
    }),
    true
  );
});

test('rejects unknown, oversized and out-of-range webview messages', () => {
  assert.equal(isWebviewMessage({ type: 'unknown' }), false);
  assert.equal(isWebviewMessage({ type: 'ready', rows: [] }), false);
  assert.equal(isWebviewMessage({ type: 'reload', path: '/tmp/data.csv' }), false);
  assert.equal(isWebviewMessage({ type: 'selectSheet', sheet: '' }), false);
  assert.equal(isWebviewMessage({ type: 'selectSheet', sheet: 'x'.repeat(129) }), false);
  assert.equal(
    isWebviewMessage({ type: 'copy', kind: 'cell', rowIndex: -1, columnIndex: 0 }),
    false
  );
  assert.equal(
    isWebviewMessage({ type: 'copy', kind: 'rawData', rowIndex: 0, columnIndex: 0 }),
    false
  );
  assert.equal(
    isWebviewMessage({
      type: 'copy', kind: 'cell', rowIndex: 0, columnIndex: 0, rows: [['secret']]
    }),
    false
  );
  assert.equal(
    isWebviewMessage({
      type: 'updateParsing', settings: parsingSettings({
        nullTokens: Array.from({ length: 21 }, () => 'NA')
      })
    }),
    false
  );
  assert.equal(
    isWebviewMessage({
      type: 'updateParsing', settings: parsingSettings({ nullTokens: ['x'.repeat(65)] })
    }),
    false
  );
  assert.equal(
    isWebviewMessage({
      type: 'updateParsing', settings: { ...parsingSettings(), nested: { rows: [] } }
    }),
    false
  );
});

function parsingSettings(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    delimiter: 'auto',
    encoding: 'utf8',
    header: 'firstNonEmpty',
    skipRows: 0,
    quote: '"',
    escape: '"',
    nullTokens: [],
    decimalSeparator: 'dot',
    thousandsSeparator: 'none',
    ...overrides
  };
}
