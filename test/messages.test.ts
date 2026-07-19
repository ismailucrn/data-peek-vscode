import assert from 'node:assert/strict';
import test from 'node:test';
import { isWebviewMessage } from '../src/messages';

test('accepts bounded clipboard requests with preview indexes', () => {
  assert.equal(
    isWebviewMessage({ type: 'copy', kind: 'cell', rowIndex: 12, columnIndex: 4 }),
    true
  );
});

test('rejects unknown, oversized and out-of-range webview messages', () => {
  assert.equal(isWebviewMessage({ type: 'unknown' }), false);
  assert.equal(isWebviewMessage({ type: 'selectSheet', sheet: 'x'.repeat(129) }), false);
  assert.equal(
    isWebviewMessage({ type: 'copy', kind: 'cell', rowIndex: -1, columnIndex: 0 }),
    false
  );
  assert.equal(
    isWebviewMessage({ type: 'copy', kind: 'rawData', rowIndex: 0, columnIndex: 0 }),
    false
  );
});
