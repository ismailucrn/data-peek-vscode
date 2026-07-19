import assert from 'node:assert/strict';
import test from 'node:test';
import {
  defaultDelimitedParsingSettings,
  localizedNumber,
  validateDelimitedParsingSettings
} from '../src/parsing';

test('validates bounded delimited parsing settings', () => {
  const settings = {
    ...defaultDelimitedParsingSettings(),
    delimiter: 'custom',
    customDelimiter: '^',
    nullTokens: ['NA', 'NULL'],
    decimalSeparator: 'comma',
    thousandsSeparator: 'dot'
  };
  assert.deepEqual(validateDelimitedParsingSettings(settings).value, settings);
});

test('rejects unsafe or ambiguous delimited parsing settings', () => {
  const defaults = defaultDelimitedParsingSettings();
  assert.equal(
    validateDelimitedParsingSettings({ ...defaults, skipRows: 10_001 }).field,
    'skipRows'
  );
  assert.equal(
    validateDelimitedParsingSettings({ ...defaults, delimiter: 'custom', customDelimiter: '\n' })
      .field,
    'customDelimiter'
  );
  assert.equal(
    validateDelimitedParsingSettings({
      ...defaults,
      decimalSeparator: 'comma',
      thousandsSeparator: 'comma'
    }).field,
    'thousandsSeparator'
  );
  assert.equal(
    validateDelimitedParsingSettings({
      ...defaults,
      nullTokens: Array.from({ length: 21 }, (_, index) => String(index))
    }).field,
    'nullTokens'
  );
});

test('normalizes locale-aware numbers without accepting malformed grouping', () => {
  assert.equal(localizedNumber('1.234,50', 'comma', 'dot'), 1234.5);
  assert.equal(localizedNumber('12 345,5', 'comma', 'space'), 12345.5);
  assert.equal(localizedNumber('12.34,5', 'comma', 'dot'), undefined);
  assert.equal(localizedNumber('0012', 'dot', 'none'), undefined);
});
