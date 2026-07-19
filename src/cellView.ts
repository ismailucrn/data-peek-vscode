import { SerializableCell } from './types';

export function formatCellDetail(value: SerializableCell): string {
  if (value === null) return 'null';
  if (typeof value !== 'string') return String(value);
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      return value;
    }
  }
  return value;
}
