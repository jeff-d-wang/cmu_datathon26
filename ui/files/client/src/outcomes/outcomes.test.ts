import { describe, expect, test } from 'vitest';
import { wilson } from './wilson';
import { composeTier, outcomeFor, tierFromOutcome } from './lookup';
import { validateOutcomes } from './validate';
import { adaptRows } from './adapter';
import { outcomesVisible } from './config';
import type { OutcomeRow } from './contract';
import { assessLayerA } from '../domain/severity';
import fixture from './fixture.sample.json';

const known = ['chest_pressure', 'breathless', 'fainting', 'racing_heartbeat', 'swollen_legs', 'unusual_tiredness'];
const base: OutcomeRow = {
  symptom_code: 'chest_pressure', age_band: 'all', sex: 'all', condition: null, n_cases: 100, n_emergency: 20, n_admitted: null,
  n_surgery_or_procedure: null, source_name: 'test', source_url: 'https://example.invalid', license: 'CC-BY', year: 2020,
  country_or_region: 'India', population_description: 'test',
};
const row = (o: Partial<OutcomeRow>): OutcomeRow => ({ ...base, ...o });

describe('Wilson score interval (known values, z = 1.96)', () => {
  test.each([
    [5, 10, 0.2366, 0.7634],
    [0, 10, 0, 0.2775],
    [10, 10, 0.7225, 1],
    [20, 100, 0.1334, 0.2888],
  ])('x=%i n=%i -> [%f, %f]', (x, n, lo, hi) => {
    const w = wilson(x, n);
    expect(w.lo).toBeCloseTo(lo, 3);
    expect(w.hi).toBeCloseTo(hi, 3);
  });
  test('rejects impossible input', () => {
    expect(() => wilson(11, 10)).toThrow();
    expect(() => wilson(1, 0)).toThrow();
  });
});

describe('minimum-cell suppression and fallback', () => {
  const rows = [
    row({ age_band: '40-59', sex: 'female', n_cases: 22, n_emergency: 5 }),
    row({ age_band: '40-59', sex: 'all', n_cases: 150, n_emergency: 39 }),
    row({ age_band: 'all', sex: 'all', n_cases: 400, n_emergency: 88 }),
  ];
  test('a cell below the minimum never shows a number; falls back to a broader group and says which', () => {
    const s = outcomeFor(rows, 'chest_pressure', '40-59', 'female', 30);
    expect(s.status).toBe('ok');
    if (s.status === 'ok') {
      expect(s.level).toBe('age');
      expect(s.n).toBe(150);
    }
  });
  test('everything below the minimum -> insufficient (no number)', () => {
    const s = outcomeFor([row({ n_cases: 12, n_emergency: 3 })], 'chest_pressure', 'all', 'all', 30);
    expect(s).toEqual({ status: 'insufficient', symptom: 'chest_pressure' });
  });
  test('rows with a condition are not used for the overall figure', () => {
    const s = outcomeFor([row({ condition: 'diabetes', n_cases: 500 })], 'chest_pressure', 'all', 'all', 30);
    expect(s.status).toBe('insufficient');
  });
});

describe('Layer A is never overridden by Layer B', () => {
  test('B lower than A -> A stays', () => expect(composeTier('URGENT', 'ROUTINE')).toEqual({ tier: 'URGENT', raisedByB: false, mismatch: true }));
  test('B higher than A -> higher shown, mismatch flagged', () => expect(composeTier('ROUTINE', 'URGENT')).toEqual({ tier: 'URGENT', raisedByB: true, mismatch: true }));
  test('emergency from A can never be lowered', () => expect(composeTier('EMERGENCY_NOW', 'ROUTINE').tier).toBe('EMERGENCY_NOW'));
  test('no B data -> A unchanged', () => expect(composeTier('ROUTINE', null)).toEqual({ tier: 'ROUTINE', raisedByB: false, mismatch: false }));
  test('red flags always make Layer A EMERGENCY_NOW', () => expect(assessLayerA(['unusual_tiredness'], true, 'urgent').tier).toBe('EMERGENCY_NOW'));
  test('B tier uses the lower bound of the interval', () => {
    const s = outcomeFor([row({ n_cases: 40, n_emergency: 6 })], 'chest_pressure', 'all', 'all', 30); // p=0.15, lo~0.07
    expect(tierFromOutcome(s, { urgent: 0.1, emergency: 0.5 })).toBe('ROUTINE');
  });
});

describe('feature flag and visibility', () => {
  test('flag off hides Layer B completely', () => expect(outcomesVisible({ enabled: false, valid: true, isDev: true, isFixture: false })).toBe(false));
  test('the synthetic fixture is never visible in production builds', () => expect(outcomesVisible({ enabled: true, valid: true, isDev: false, isFixture: true })).toBe(false));
  test('invalid data is hidden', () => expect(outcomesVisible({ enabled: true, valid: false, isDev: true, isFixture: false })).toBe(false));
  test('real, valid data with the flag on is shown', () => expect(outcomesVisible({ enabled: true, valid: true, isDev: false, isFixture: false })).toBe(true));
});

describe('validation at load', () => {
  test('the SAMPLE FIXTURE passes and reports symptoms with no data', () => {
    const v = validateOutcomes(adaptRows(fixture.rows), known, 30);
    expect(v.ok).toBe(true);
    expect(v.report.symptomsWithNoData).toContain('unusual_tiredness');
    expect(v.report.cellsBelowMin).toBeGreaterThan(0);
  });
  test.each([
    ['n_emergency > n_cases', [row({ n_emergency: 101 })], 'n_emergency > n_cases'],
    ['negative counts', [row({ n_cases: -1, n_emergency: 0 })], 'non-negative'],
    ['duplicate cells', [row({}), row({})], 'duplicate cell'],
    ['bad age band', [row({ age_band: '40-49' as OutcomeRow['age_band'] })], 'age_band'],
    ['bad sex', [row({ sex: 'f' as OutcomeRow['sex'] })], 'sex'],
    ['missing license', [row({ license: '' })], 'license'],
    ['unknown symptom', [row({ symptom_code: 'headache' })], 'not in symptom_map.json'],
  ])('rejects %s', (_name, rows, msg) => {
    const v = validateOutcomes(rows, known, 30);
    expect(v.ok).toBe(false);
    expect(v.errors.join(' | ')).toContain(msg);
  });
});
