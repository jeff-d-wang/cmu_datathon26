import type { AgeBand, OutcomeRow, Sex } from './contract';
import { wilson } from './wilson';
import { higherTier, type SeverityTier } from '../domain/severity';

export type FallbackLevel = 'age_and_sex' | 'age' | 'sex' | 'everyone';

export type OutcomeStat =
  | { status: 'ok'; symptom: string; x: number; n: number; p: number; lo: number; hi: number; level: FallbackLevel; row: OutcomeRow }
  | { status: 'insufficient'; symptom: string };

/**
 * Minimum-cell rule: a cell with fewer than `minCases` cases never shows a number. Falls back to a
 * broader group (age+sex -> age -> sex -> everyone) and reports which group was used.
 * Only rows with condition = null (no condition filter) are used here.
 */
export function outcomeFor(rows: readonly OutcomeRow[], symptom: string, age: AgeBand, sex: Sex, minCases: number): OutcomeStat {
  const order: [AgeBand, Sex, FallbackLevel][] = [
    [age, sex, 'age_and_sex'],
    [age, 'all', 'age'],
    ['all', sex, 'sex'],
    ['all', 'all', 'everyone'],
  ];
  for (const [a, s, level] of order) {
    const row = rows.find((r) => r.symptom_code === symptom && r.age_band === a && r.sex === s && r.condition === null);
    if (row && row.n_cases >= minCases) {
      const w = wilson(row.n_emergency, row.n_cases);
      return { status: 'ok', symptom, x: row.n_emergency, n: row.n_cases, p: w.p, lo: w.lo, hi: w.hi, level, row };
    }
  }
  return { status: 'insufficient', symptom };
}

/** Layer B's own tier, from the LOWER bound of the 95% interval (conservative). DRAFT thresholds. */
export function tierFromOutcome(stat: OutcomeStat, thresholds: { urgent: number; emergency: number }): SeverityTier | null {
  if (stat.status !== 'ok') return null;
  if (stat.lo >= thresholds.emergency) return 'EMERGENCY_NOW';
  if (stat.lo >= thresholds.urgent) return 'URGENT';
  return 'ROUTINE';
}

/**
 * Layer B informs but never lowers Layer A. The shown tier is the higher of the two; any disagreement
 * is returned as a mismatch for the dev report.
 */
export function composeTier(layerA: SeverityTier, layerB: SeverityTier | null): { tier: SeverityTier; raisedByB: boolean; mismatch: boolean } {
  if (layerB === null) return { tier: layerA, raisedByB: false, mismatch: false };
  const tier = higherTier(layerA, layerB);
  return { tier, raisedByB: tier !== layerA, mismatch: layerA !== layerB };
}
