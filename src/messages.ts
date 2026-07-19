import { WebviewToHostMessage } from './types';

export function isWebviewMessage(value: unknown): value is WebviewToHostMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Record<string, unknown>;
  if (message.type === 'ready' || message.type === 'reload') return true;
  if (message.type === 'selectSheet') {
    return typeof message.sheet === 'string' && message.sheet.length <= 128;
  }
  return (
    message.type === 'copy' &&
    (message.kind === 'cell' || message.kind === 'row' || message.kind === 'columnName') &&
    typeof message.rowIndex === 'number' &&
    Number.isInteger(message.rowIndex) &&
    message.rowIndex >= 0 &&
    message.rowIndex < 5_000 &&
    typeof message.columnIndex === 'number' &&
    Number.isInteger(message.columnIndex) &&
    message.columnIndex >= 0 &&
    message.columnIndex < 2_000
  );
}
