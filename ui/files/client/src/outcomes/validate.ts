import { AGE_BANDS, REQUIRED_COLUMNS, SEXES, type OutcomeRow } from './contract';

export interface QualityReport {
  rows: number;
  missingPct: Record<string, number>;
  cellsBelowMin: number;
  symptomsWithNoData: string[];
  unknownSymptoms: string[];
}

export interface Validation {
  ok: boolean;
  errors: string[];
  report: QualityReport;
}

const isMissing = (v: unknown) => v === null || v === '' || (typeof v === 'number' && Number.isNaN(v));
const NULLABLE: (keyof OutcomeRow)[] = ['condition', 'n_admitted', 'n_surgery_or_procedure'];

/**
 * Validation at load. Does not assume the dataset is correct. Errors make the feature fail loudly
 * in dev and stay hidden in prod. The report is printed in dev (and by `npm run outcomes:report`).
 */
export function validateOutcomes(rows: readonly OutcomeRow[], knownSymptoms: readonly string[], minCases: number): Validation {
  const errors: string[] = [];
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    const at = `row ${i + 1} (${r.symptom_code}/${r.age_band}/${r.sex}/${r.condition ?? '-'})`;
    for (const c of REQUIRED_COLUMNS) if (!NULLABLE.includes(c) && isMissing(r[c])) errors.push(`${at}: missing ${c}`);
    if (!Number.isInteger(r.n_cases) || r.n_cases < 0) errors.push(`${at}: n_cases must be a non-negative integer`);
    if (!Number.isInteger(r.n_emergency) || r.n_emergency < 0) errors.push(`${at}: n_emergency must be a non-negative integer`);
    if (r.n_emergency > r.n_cases) errors.push(`${at}: n_emergency > n_cases`);
    for (const c of ['n_admitted', 'n_surgery_or_procedure'] as const) {
      const v = r[c];
      if (v !== null && (!Number.isInteger(v) || v < 0 || v > r.n_cases)) errors.push(`${at}: ${c} must be 0..n_cases or null`);
    }
    if (!(AGE_BANDS as readonly string[]).includes(r.age_band)) errors.push(`${at}: age_band "${r.age_band}" not in ${AGE_BANDS.join(', ')}`);
    if (!(SEXES as readonly string[]).includes(r.sex)) errors.push(`${at}: sex "${r.sex}" not in ${SEXES.join(', ')}`);
    if (!r.license) errors.push(`${at}: license missing`);
    if (!knownSymptoms.includes(r.symptom_code)) errors.push(`${at}: symptom_code "${r.symptom_code}" not in symptom_map.json`);
    const key = `${r.symptom_code}|${r.age_band}|${r.sex}|${r.condition ?? ''}`;
    if (seen.has(key)) errors.push(`${at}: duplicate cell`);
    seen.add(key);
  });
  const missingPct: Record<string, number> = {};
  for (const c of REQUIRED_COLUMNS) missingPct[c] = rows.length ? Math.round((1000 * rows.filter((r) => isMissing(r[c])).length) / rows.length) / 10 : 0;
  const present = new Set(rows.map((r) => r.symptom_code));
  return {
    ok: errors.length === 0 && rows.length > 0,
    errors: rows.length === 0 ? ['no rows'] : errors,
    report: {
      rows: rows.length,
      missingPct,
      cellsBelowMin: rows.filter((r) => r.n_cases < minCases).length,
      symptomsWithNoData: knownSymptoms.filter((s) => !present.has(s)),
      unknownSymptoms: [...present].filter((s) => !knownSymptoms.includes(s)),
    },
  };
}
