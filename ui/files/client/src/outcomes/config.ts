import symptomMap from '../../../config/symptom_map.json';
import fixture from './fixture.sample.json';
import { adaptRows } from './adapter';
import { validateOutcomes, type Validation } from './validate';
import type { OutcomeRow } from './contract';

/** Feature flag (client env). Default OFF: Layer B is completely hidden. */
export const OUTCOMES_ENABLED: boolean = import.meta.env.VITE_OUTCOMES_ENABLED === 'true';
export const MIN_CASES: number = symptomMap.outcomes_min_cases;
export const THRESHOLDS = {
  urgent: symptomMap.outcome_thresholds.urgent_min_emergency_rate,
  emergency: symptomMap.outcome_thresholds.emergency_min_emergency_rate,
};
export const KNOWN_SYMPTOMS: string[] = symptomMap.symptoms.map((s) => s.id);

/** Real teammate data goes here (via adapter.ts) once it exists. Until then: none. */
const REAL_ROWS: Record<string, unknown>[] = [];

/** Pure visibility rule (unit-tested): flag on, data valid, and the synthetic fixture only in dev builds. */
export function outcomesVisible(opts: { enabled: boolean; valid: boolean; isDev: boolean; isFixture: boolean }): boolean {
  return opts.enabled && opts.valid && (!opts.isFixture || opts.isDev);
}

export interface LoadedOutcomes {
  rows: OutcomeRow[];
  validation: Validation;
  isFixture: boolean;
}

let cache: LoadedOutcomes | null | undefined;

/** Loads Layer B. Fails loudly in dev (throws); hides the feature in prod when validation fails. */
export function loadOutcomes(): LoadedOutcomes | null {
  if (cache !== undefined) return cache;
  const isDev = import.meta.env.DEV;
  const isFixture = REAL_ROWS.length === 0;
  if (!OUTCOMES_ENABLED || (isFixture && !isDev)) return (cache = null);
  const rows = adaptRows(isFixture ? fixture.rows : REAL_ROWS);
  const validation = validateOutcomes(rows, KNOWN_SYMPTOMS, MIN_CASES);
  if (isDev) {
    console.groupCollapsed(`[Layer B] outcome data quality report${isFixture ? ' (SAMPLE FIXTURE, NOT REAL DATA)' : ''}`);
    console.table(validation.report.missingPct);
    console.log(validation.report);
    if (validation.errors.length) console.error(validation.errors);
    console.groupEnd();
    if (!validation.ok) throw new Error(`Layer B outcome data failed validation: ${validation.errors.slice(0, 5).join('; ')}`);
  }
  return (cache = outcomesVisible({ enabled: OUTCOMES_ENABLED, valid: validation.ok, isDev, isFixture }) ? { rows, validation, isFixture } : null);
}
