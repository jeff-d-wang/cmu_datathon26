/**
 * LAYER B data contract (one table or file, filled by a teammate). If the real columns differ,
 * change adapter.ts, never the UI.
 */
export const AGE_BANDS = ['0-17', '18-39', '40-59', '60+', 'all'] as const;
export const SEXES = ['female', 'male', 'all'] as const;
export type AgeBand = (typeof AGE_BANDS)[number];
export type Sex = (typeof SEXES)[number];

export interface OutcomeRow {
  symptom_code: string;
  age_band: AgeBand;
  sex: Sex;
  condition: string | null;
  n_cases: number;
  n_emergency: number;
  n_admitted: number | null;
  n_surgery_or_procedure: number | null;
  source_name: string;
  source_url: string;
  license: string;
  year: number;
  country_or_region: string;
  population_description: string;
}

export const REQUIRED_COLUMNS: (keyof OutcomeRow)[] = [
  'symptom_code', 'age_band', 'sex', 'condition', 'n_cases', 'n_emergency', 'n_admitted', 'n_surgery_or_procedure',
  'source_name', 'source_url', 'license', 'year', 'country_or_region', 'population_description',
];

export const ageBandFor = (age: number | null): AgeBand =>
  age === null ? 'all' : age < 18 ? '0-17' : age < 40 ? '18-39' : age < 60 ? '40-59' : '60+';
export const sexFor = (sex: 'woman' | 'man' | 'other' | null): Sex => (sex === 'woman' ? 'female' : sex === 'man' ? 'male' : 'all');
