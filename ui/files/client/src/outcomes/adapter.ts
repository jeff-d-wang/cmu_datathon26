import type { OutcomeRow } from './contract';

/**
 * Adapter from the teammate's raw rows to the contract. Unknown values are kept as-is so that
 * validate.ts can reject them loudly; nothing is silently "fixed" here.
 * Column aliases: add mappings here if the delivered dataset uses different names.
 */
const ALIASES: Record<string, keyof OutcomeRow> = {
  symptom: 'symptom_code', symptom_code: 'symptom_code', age_band: 'age_band', age_group: 'age_band', sex: 'sex', gender: 'sex',
  condition: 'condition', n_cases: 'n_cases', cases: 'n_cases', n_emergency: 'n_emergency', emergency_visits: 'n_emergency',
  n_admitted: 'n_admitted', n_surgery_or_procedure: 'n_surgery_or_procedure', source_name: 'source_name', source_url: 'source_url',
  license: 'license', year: 'year', country_or_region: 'country_or_region', population_description: 'population_description',
};

const num = (v: unknown): number => (v === null || v === undefined || v === '' ? Number.NaN : Number(v));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));
const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

export function adaptRows(raw: readonly Record<string, unknown>[]): OutcomeRow[] {
  return raw.map((r) => {
    const m: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) {
      const key = ALIASES[k.toLowerCase().trim()];
      if (key) m[key] = v;
    }
    const cond = text(m.condition);
    return {
      symptom_code: text(m.symptom_code),
      age_band: text(m.age_band) as OutcomeRow['age_band'],
      sex: text(m.sex).toLowerCase() as OutcomeRow['sex'],
      condition: cond === '' || cond.toLowerCase() === 'null' ? null : cond,
      n_cases: num(m.n_cases),
      n_emergency: num(m.n_emergency),
      n_admitted: numOrNull(m.n_admitted),
      n_surgery_or_procedure: numOrNull(m.n_surgery_or_procedure),
      source_name: text(m.source_name),
      source_url: text(m.source_url),
      license: text(m.license),
      year: num(m.year),
      country_or_region: text(m.country_or_region),
      population_description: text(m.population_description),
    };
  });
}
