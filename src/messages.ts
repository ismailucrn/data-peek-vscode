import { WebviewToHostMessage } from './types';

export function isWebviewMessage(value: unknown): value is WebviewToHostMessage {
  if (!isRecord(value)) return false;
  const message = value;
  if (message.type === 'ready' || message.type === 'reload') {
    return hasKeys(message, ['type']);
  }
  if (message.type === 'selectSheet') {
    return (
      hasKeys(message, ['type', 'sheet']) &&
      typeof message.sheet === 'string' &&
      message.sheet.length > 0 &&
      message.sheet.length <= 128
    );
  }
  if (message.type === 'updateParsing') {
    if (!hasKeys(message, ['type', 'settings'])) return false;
    if (message.settings === null) return true;
    return isBoundedParsingSettings(message.settings);
  }
  return (
    message.type === 'copy' &&
    hasKeys(message, ['type', 'kind', 'rowIndex', 'columnIndex']) &&
    (message.kind === 'cell' || message.kind === 'row' || message.kind === 'columnName') &&
    Number.isInteger(message.rowIndex) &&
    (message.rowIndex as number) >= 0 &&
    (message.rowIndex as number) < 5_000 &&
    Number.isInteger(message.columnIndex) &&
    (message.columnIndex as number) >= 0 &&
    (message.columnIndex as number) < 2_000
  );
}

function isBoundedParsingSettings(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (
    !hasKeys(
      value,
      [
        'delimiter',
        'encoding',
        'header',
        'skipRows',
        'quote',
        'escape',
        'nullTokens',
        'decimalSeparator',
        'thousandsSeparator'
      ],
      ['customDelimiter']
    ) ||
    typeof value.delimiter !== 'string' ||
    value.delimiter.length > 16 ||
    (value.customDelimiter !== undefined &&
      (typeof value.customDelimiter !== 'string' || value.customDelimiter.length > 2)) ||
    typeof value.encoding !== 'string' ||
    value.encoding.length > 16 ||
    typeof value.header !== 'string' ||
    value.header.length > 32 ||
    !Number.isInteger(value.skipRows) ||
    typeof value.quote !== 'string' ||
    value.quote.length > 2 ||
    typeof value.escape !== 'string' ||
    value.escape.length > 2 ||
    !Array.isArray(value.nullTokens) ||
    value.nullTokens.length > 20 ||
    !value.nullTokens.every((token) => typeof token === 'string' && token.length <= 64) ||
    typeof value.decimalSeparator !== 'string' ||
    value.decimalSeparator.length > 16 ||
    typeof value.thousandsSeparator !== 'string' ||
    value.thousandsSeparator.length > 16
  ) {
    return false;
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = []
): boolean {
  const allowedKeys = new Set([...required, ...optional]);
  return (
    required.every((key) => Object.prototype.hasOwnProperty.call(value, key)) &&
    Object.keys(value).every((key) => allowedKeys.has(key))
  );
}
