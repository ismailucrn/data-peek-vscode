import { ColumnProfile, QualityWarning } from './types';

export function buildQualityWarnings(profiles: ColumnProfile[]): QualityWarning[] {
  const warnings: QualityWarning[] = [];
  profiles.forEach((profile, columnIndex) => {
    if (profile.type === 'mixed') {
      warnings.push({
        code: 'mixedType',
        columnIndex,
        message: `${profile.name} contains mixed value types across the full dataset.`
      });
    }
    if (profile.nonNull === 0) {
      warnings.push({
        code: 'allEmpty',
        columnIndex,
        message: `${profile.name} is entirely empty.`
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
  return warnings;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
