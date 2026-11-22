import { describe, expect, it } from 'vitest';
import { distanceFactor, parseNeeds } from './contract';
import { FIXTURE_ENTRIES, getEngineResult } from './fixture';
import { mapQuery } from './source';

describe('contract', () => {
  it('parseNeeds turns tuples into objects, None to null', () => {
    expect(parseNeeds([['ecg', 0.86, 0.83, 0.9], ['icu', 0.35, null, null]])).toEqual([
      { service: 'ecg', share: 0.86, ciLo: 0.83, ciHi: 0.9 },
      { service: 'icu', share: 0.35, ciLo: null, ciHi: null },
    ]);
  });
  it('distance factor, tau 15 km at 5.6 km', () => expect(distanceFactor(5.6, 15)).toBeCloseTo(0.878, 3));
});

describe('symptom to query mapping', () => {
  it('maps known ids and falls back', () => {
    expect(mapQuery(['chest_pressure'], '')).toBe('chest pain');
    expect(mapQuery(['stroke_signs'], '')).toBe('stroke symptoms, face drooping');
    expect(mapQuery(['kidney'], '')).toBe('need dialysis for kidney failure');
    expect(mapQuery(['cough'], 'itchy skin')).toBe('uneasy since yesterday');
  });
  it('picks by (query, pin); null for an unknown PIN', () => {
    expect(getEngineResult(['chest_pressure'], '', '302001')?.results[0].name).toBe('Shekhawati Hospital & Research Centre');
    expect(getEngineResult(['kidney'], '', '800001')?.label).toMatch(/Dialysis/);
    expect(getEngineResult(['chest_pressure'], '', '999999')).toBeNull();
  });
});

describe('fixture rows: score = match x relevance x distance x trust (within 0.02)', () => {
  for (const e of FIXTURE_ENTRIES) {
    for (const r of e.results) {
      it(`${e.query} / ${e.pin} / ${r.name}`, () => {
        expect(Math.abs(r.match * r.relevance * distanceFactor(r.km, e.tolerance_km) * r.trust - r.score)).toBeLessThanOrEqual(0.02);
      });
    }
  }
});
