import { WebviewToHostMessage } from './types';

export function isWebviewMessage(value: unknown): value is WebviewToHostMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Record<string, unknown>;
  if (message.type === 'ready' || message.type === 'reload') return true;
  if (message.type === 'selectSheet') {
    return typeof message.sheet === 'string' && message.sheet.length <= 128;
  }
  if (message.type === 'updateParsing') {
    if (message.settings === null) return true;
    if (!message.settings || typeof message.settings !== 'object' || Array.isArray(message.settings)) {
      return false;
    }
    const settings = message.settings as Record<string, unknown>;
    return (
      (!Array.isArray(settings.nullTokens) || settings.nullTokens.length <= 21) &&
      (!Array.isArray(settings.nullTokens) ||
        settings.nullTokens.every((token) => typeof token === 'string' && token.length <= 65)) &&
      Object.values(settings).every(
        (item) => typeof item !== 'string' || item.length <= 128
      )
    );
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
