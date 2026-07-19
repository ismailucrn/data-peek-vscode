import { ColumnProfile, QualityWarning, SerializableCell, TruncationInfo } from './types';

export function buildQualityWarnings(
  profiles: ColumnProfile[],
  rows: SerializableCell[][],
  truncation: TruncationInfo
): QualityWarning[] {
  const warnings: QualityWarning[] = [];
  profiles.forEach((profile, columnIndex) => {
    if (profile.type === 'mixed') {
      warnings.push({
        code: 'mixedType',
        columnIndex,
        message: `${profile.name} contains mixed value types.`
      });
    }
    if (profile.nonNull === 0) {
      warnings.push({
        code: 'allEmpty',
        columnIndex,
        message: `${profile.name} is entirely empty in the preview.`
      });
    } else if (profile.distinct === 1) {
      warnings.push({
        code: 'constant',
        columnIndex,
        message: `${profile.name} contains one non-null value.`
      });
    }
    if (profile.missingRatio >= 0.2) {
      warnings.push({
        code: 'highMissing',
        columnIndex,
        message: `${profile.name} is ${formatPercent(profile.missingRatio)} missing.`
      });
    }
    if (profile.nonNull >= 20 && profile.uniqueRatio >= 0.98) {
      warnings.push({
        code: 'possibleIdentifier',
        columnIndex,
        message: `${profile.name} may be an identifier (${formatPercent(profile.uniqueRatio)} unique).`
      });
    }
  });

  const duplicateCount = countDuplicateRows(rows);
  if (duplicateCount > 0) {
    warnings.push({
      code: 'duplicateRows',
      count: duplicateCount,
      message: `${duplicateCount} duplicate preview ${duplicateCount === 1 ? 'row' : 'rows'} detected.`
    });
  }
  if (truncation.rows) {
    warnings.push({
      code: 'truncatedRows',
      message: 'The source contains more rows than the loaded preview.'
    });
  }
  if (truncation.columns) {
    warnings.push({
      code: 'truncatedColumns',
      message: 'The source contains columns that are not loaded into the preview.'
    });
  }
  if (truncation.cells > 0) {
    warnings.push({
      code: 'truncatedCells',
      count: truncation.cells,
      message: `${truncation.cells} preview ${truncation.cells === 1 ? 'cell was' : 'cells were'} shortened for safety.`
    });
  }
  return warnings;
}

function countDuplicateRows(rows: SerializableCell[][]): number {
  const seen = new Set<string>();
  let duplicates = 0;
  for (const row of rows) {
    const key = JSON.stringify(row.map((value) => [typeof value, value]));
    if (seen.has(key)) duplicates += 1;
    else seen.add(key);
  }
  return duplicates;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
