import {
  DecimalSeparator,
  DelimitedEncoding,
  DelimitedParsingSettings,
  DelimiterOption,
  HeaderMode,
  ThousandsSeparator
} from './types';

const DELIMITERS = new Set<DelimiterOption>([
  'auto',
  'comma',
  'semicolon',
  'tab',
  'pipe',
  'custom'
]);
const ENCODINGS = new Set<DelimitedEncoding>(['utf8', 'utf16le', 'latin1']);
const HEADER_MODES = new Set<HeaderMode>(['firstNonEmpty', 'none']);
const DECIMAL_SEPARATORS = new Set<DecimalSeparator>(['dot', 'comma']);
const THOUSANDS_SEPARATORS = new Set<ThousandsSeparator>([
  'none',
  'comma',
  'dot',
  'space'
]);
const MAX_NULL_TOKENS = 20;
const MAX_NULL_TOKEN_LENGTH = 64;

export interface ParsingValidationResult {
  value?: DelimitedParsingSettings;
  error?: string;
  field?: keyof DelimitedParsingSettings;
}

export function defaultDelimitedParsingSettings(): DelimitedParsingSettings {
  return {
    delimiter: 'auto',
    encoding: 'utf8',
    header: 'firstNonEmpty',
    skipRows: 0,
    quote: '"',
    escape: '"',
    nullTokens: [],
    decimalSeparator: 'dot',
    thousandsSeparator: 'none'
  };
}

export function validateDelimitedParsingSettings(value: unknown): ParsingValidationResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { error: 'Parsing settings must be an object.' };
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.delimiter !== 'string' || !DELIMITERS.has(candidate.delimiter as DelimiterOption)) {
    return { error: 'Select a supported delimiter.', field: 'delimiter' };
  }
  const delimiter = candidate.delimiter as DelimiterOption;
  const customDelimiter = typeof candidate.customDelimiter === 'string'
    ? candidate.customDelimiter
    : undefined;
  if (delimiter === 'custom' && !isSingleSafeCharacter(customDelimiter)) {
    return { error: 'Custom delimiter must be one non-line-break character.', field: 'customDelimiter' };
  }
  if (typeof candidate.encoding !== 'string' || !ENCODINGS.has(candidate.encoding as DelimitedEncoding)) {
    return { error: 'Select a supported encoding.', field: 'encoding' };
  }
  if (typeof candidate.header !== 'string' || !HEADER_MODES.has(candidate.header as HeaderMode)) {
    return { error: 'Select a supported header mode.', field: 'header' };
  }
  if (
    typeof candidate.skipRows !== 'number' ||
    !Number.isInteger(candidate.skipRows) ||
    candidate.skipRows < 0 ||
    candidate.skipRows > 10_000
  ) {
    return { error: 'Rows to skip must be an integer from 0 to 10,000.', field: 'skipRows' };
  }
  if (!isSingleSafeCharacter(candidate.quote)) {
    return { error: 'Quote must be one non-line-break character.', field: 'quote' };
  }
  if (!isSingleSafeCharacter(candidate.escape)) {
    return { error: 'Escape must be one non-line-break character.', field: 'escape' };
  }
  const resolvedDelimiter = delimiterCharacter(delimiter, customDelimiter);
  if (resolvedDelimiter && resolvedDelimiter === candidate.quote) {
    return { error: 'Delimiter and quote must be different characters.', field: 'delimiter' };
  }
  if (!Array.isArray(candidate.nullTokens) || candidate.nullTokens.length > MAX_NULL_TOKENS) {
    return { error: 'Enter at most 20 null tokens.', field: 'nullTokens' };
  }
  const nullTokens: string[] = [];
  for (const token of candidate.nullTokens) {
    if (typeof token !== 'string' || token.length === 0 || token.length > MAX_NULL_TOKEN_LENGTH) {
      return { error: 'Each null token must contain 1 to 64 characters.', field: 'nullTokens' };
    }
    if (!nullTokens.includes(token)) nullTokens.push(token);
  }
  if (
    typeof candidate.decimalSeparator !== 'string' ||
    !DECIMAL_SEPARATORS.has(candidate.decimalSeparator as DecimalSeparator)
  ) {
    return { error: 'Select a supported decimal separator.', field: 'decimalSeparator' };
  }
  if (
    typeof candidate.thousandsSeparator !== 'string' ||
    !THOUSANDS_SEPARATORS.has(candidate.thousandsSeparator as ThousandsSeparator)
  ) {
    return { error: 'Select a supported thousands separator.', field: 'thousandsSeparator' };
  }
  const decimalSeparator = candidate.decimalSeparator as DecimalSeparator;
  const thousandsSeparator = candidate.thousandsSeparator as ThousandsSeparator;
  if (
    (decimalSeparator === 'dot' && thousandsSeparator === 'dot') ||
    (decimalSeparator === 'comma' && thousandsSeparator === 'comma')
  ) {
    return {
      error: 'Decimal and thousands separators must be different.',
      field: 'thousandsSeparator'
    };
  }

  return {
    value: {
      delimiter,
      ...(customDelimiter ? { customDelimiter } : {}),
      encoding: candidate.encoding as DelimitedEncoding,
      header: candidate.header as HeaderMode,
      skipRows: candidate.skipRows,
      quote: candidate.quote as string,
      escape: candidate.escape as string,
      nullTokens,
      decimalSeparator,
      thousandsSeparator
    }
  };
}

export function delimiterCharacter(
  delimiter: DelimiterOption,
  customDelimiter?: string
): string | undefined {
  if (delimiter === 'comma') return ',';
  if (delimiter === 'semicolon') return ';';
  if (delimiter === 'tab') return '\t';
  if (delimiter === 'pipe') return '|';
  if (delimiter === 'custom') return customDelimiter;
  return undefined;
}

export function localizedNumber(
  value: string,
  decimalSeparator: DecimalSeparator,
  thousandsSeparator: ThousandsSeparator
): number | undefined {
  if (decimalSeparator === 'dot' && thousandsSeparator === 'none') return undefined;
  const decimal = decimalSeparator === 'dot' ? '.' : ',';
  const thousands =
    thousandsSeparator === 'none'
      ? undefined
      : thousandsSeparator === 'space'
        ? ' '
        : thousandsSeparator === 'dot'
          ? '.'
          : ',';
  const escapedDecimal = escapeRegExp(decimal);
  const escapedThousands = thousands ? escapeRegExp(thousands) : '';
  const integerPattern = thousands
    ? `(?:\\d{1,3}(?:${escapedThousands}\\d{3})+|\\d+)`
    : '\\d+';
  const pattern = new RegExp(`^[+-]?${integerPattern}(?:${escapedDecimal}\\d+)?(?:[eE][+-]?\\d+)?$`);
  if (!pattern.test(value.trim())) return undefined;
  let normalized = value.trim();
  if (thousands) normalized = normalized.split(thousands).join('');
  if (decimal !== '.') normalized = normalized.replace(decimal, '.');
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function isSingleSafeCharacter(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    [...value].length === 1 &&
    value !== '\r' &&
    value !== '\n' &&
    value !== '\0'
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
