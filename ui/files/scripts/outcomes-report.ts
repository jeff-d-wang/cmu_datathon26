/**
 * Data-quality report for the Layer B outcome file (JSON array, {rows:[...]}, or CSV).
 * Usage: npm run outcomes:report -- path/to/outcomes.csv
 * Exits 1 when validation fails. Does not assume the dataset is correct.
 */
import { readFileSync } from 'node:fs';
import { adaptRows } from '../client/src/outcomes/adapter';
import { validateOutcomes } from '../client/src/outcomes/validate';

const path = process.argv[2] ?? 'client/src/outcomes/fixture.sample.json';
const map = JSON.parse(readFileSync('config/symptom_map.json', 'utf8')) as { symptoms: { id: string }[]; outcomes_min_cases: number };
const text = readFileSync(path, 'utf8');

function parseCsv(t: string): Record<string, unknown>[] {
  const [head, ...lines] = t.trim().split(/\r?\n/);
  const cols = head.split(',').map((c) => c.trim());
  return lines.map((l) => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v.trim()])));
}

const raw: Record<string, unknown>[] = path.endsWith('.csv') ? parseCsv(text) : (() => { const j = JSON.parse(text) as unknown; return Array.isArray(j) ? (j as Record<string, unknown>[]) : ((j as { rows: Record<string, unknown>[] }).rows ?? []); })();
const v = validateOutcomes(adaptRows(raw), map.symptoms.map((s) => s.id), map.outcomes_min_cases);
console.log(`Layer B data quality report: ${path}`);
console.log(`rows: ${v.report.rows} | cells below minimum (${map.outcomes_min_cases}): ${v.report.cellsBelowMin}`);
console.log('missing % by column:', v.report.missingPct);
console.log('symptoms with no data:', v.report.symptomsWithNoData.join(', ') || 'none');
console.log('symptom codes not in symptom_map.json:', v.report.unknownSymptoms.join(', ') || 'none');
if (!v.ok) {
  console.error(`VALIDATION FAILED (${v.errors.length} errors):\n- ${v.errors.slice(0, 50).join('\n- ')}`);
  process.exit(1);
}
console.log('validation: OK');
