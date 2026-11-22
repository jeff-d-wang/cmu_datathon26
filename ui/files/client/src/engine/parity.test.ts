import { describe, expect, it } from 'vitest';
import parity from './data/parity_rows.json';
import { run } from './method';
import { toEngineFacility } from './rows';

// Parity with the printed demo (engine-src/api_outputs.txt), using real clean-table rows for the facilities it names.
// The candidate set here is ONLY those facilities, so absolute ranks are not compared; per-facility score and factors are.
const FACS = (parity.rows as Record<string, unknown>[]).map(toEngineFacility);
const byName = (n: string) => FACS.find((f) => f.name === n);

// [query, pin, [name, printed km, printed score, printed match]]
const PRINTED: [string, string, [string, number, number, number][]][] = [
  ['chest pain', '302001', [['Shekhawati Hospital & Research Centre', 5.6, 0.728, 0.83], ['Nims Heart And Brain Hospital - Nhbh', 2.6, 0.704, 0.72], ['Soni Hospital', 2.6, 0.695, 0.71]]],
  ['stroke symptoms, face drooping', '302001', [['Soni Hospital', 2.6, 0.925, 0.95], ['Surya Hospitals Jaipur', 1.5, 0.846, 0.85], ['Nims Heart And Brain Hospital - Nhbh', 2.6, 0.799, 0.82]]],
  ['child swallowed too many pills', '302001', [['Nims Heart And Brain Hospital - Nhbh', 2.6, 0.884, 0.91], ['NAV Imperial Hospital and Research Centre', 2.8, 0.88, 0.91], ['Shekhawati Hospital & Research Centre', 5.6, 0.878, 1.0]]],
  ['low back pain', '411001', [['Harsh Hospital', 3.4, 0.843, 0.85], ['N M Wadia Institute of Cardiology', 2.1, 0.751, 0.75], ['Mahaveer Hospital', 0.7, 0.75, 0.75]]],
  ['need dialysis for kidney failure', '800001', [['Indira Gandhi Institute of Medical Sciences', 3.6, 0.992, 1.0], ['Samarpan Trauma and Research Centre', 4.8, 0.986, 1.0], ['Advanced Neuro Hospital', 1.3, 0.973, 0.97]]],
  ['1050', '302001', [['Shekhawati Hospital & Research Centre', 5.6, 0.728, 0.83], ['Nims Heart And Brain Hospital - Nhbh', 2.6, 0.704, 0.72], ['Soni Hospital', 2.6, 0.695, 0.71]]],
  ['uneasy since yesterday', '302001', [['Nims Heart And Brain Hospital - Nhbh', 2.6, 0.996, 1.0], ['Shekhawati Hospital & Research Centre', 5.6, 0.981, 1.0], ['Tagore Hospital', 7.3, 0.968, 1.0]]],
];

describe('parity with the printed demo (real clean rows)', () => {
  const table: string[] = [];
  for (const [query, pin, rows] of PRINTED) {
    for (const [name, pkm, pscore, pmatch] of rows) {
      it(`${query} / ${pin} / ${name}`, () => {
        const f = byName(name);
        expect(f, `fixture row for ${name}`).toBeDefined();
        const pl = (parity.places as Record<string, { lat: number; lon: number }>)[pin];
        const r = run(query, pl.lat, pl.lon, [f as NonNullable<typeof f>], 1).results[0];
        table.push(`${query} | ${name} | km ${r.km} vs ${pkm} | score ${r.score} vs ${pscore} | d=${(r.score - pscore).toFixed(3)} | match ${r.match} vs ${pmatch} | trust ${r.trust}`);
        // Known difference: the clean table's PIN centroid for 302016 is ~95 km from NAV Imperial, so trust is 0.85 (the notebook's PIN directory gave 1.0).
        if (!name.startsWith('NAV Imperial')) expect(Math.abs(r.score - pscore)).toBeLessThanOrEqual(0.02);
        else expect(r.trust).toBe(0.85);
      });
    }
  }
  it('prints the table', () => {
    console.log('\n' + table.join('\n'));
  });
});
