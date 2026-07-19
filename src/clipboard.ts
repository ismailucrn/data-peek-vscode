import { SerializableCell } from './types';

export function copyCellText(value: SerializableCell): string {
  return value === null ? '' : String(value);
}

export function copyRowAsTsv(row: SerializableCell[]): string {
  return row.map(copyTsvField).join('\t');
}

function copyTsvField(value: SerializableCell): string {
  const text = copyCellText(value);
  return /[\t\r\n"]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
