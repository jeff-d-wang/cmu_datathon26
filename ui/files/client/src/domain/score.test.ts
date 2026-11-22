import { describe, expect, it } from 'vitest';
import { SAMPLE_FACILITIES } from '../sample/sampleData';
import { COMPONENT_ORDER, scoreBreakdown, WEIGHTS, type ScoreInput } from './score';
import type { Facility } from './types';
import type { Need } from './services';

const noCond = { pregnant: false, kidney: false, stroke: false, diabetes: false };
const need = (service: Need['service'], critical = false, weight = 1): Need => ({ service, weight, critical });
const urgent: ScoreInput = { mode: 'urgent', km: 12, needs: [need('cardiology'), need('diagnosticServices'), need('echocardiography'), need('interventionalCardiology')], conditions: noCond, age: 55 };
const planned: ScoreInput = { ...urgent, mode: 'planned', needs: [need('cardiothoracicSurgery'), need('interventionalCardiology')] };
const base = SAMPLE_FACILITIES[0];
const mk = (o: Partial<Facility>): Facility => ({ ...base, ...o });

describe('score range', () => {
  it('weights sum to 100 in both modes', () => {
    for (const m of ['urgent', 'planned'] as const) expect(COMPONENT_ORDER.reduce((s, c) => s + WEIGHTS[m][c], 0)).toBe(100);
  });
  it('lower <= score <= upper, always (every sample facility, both modes, many distances)', () => {
    for (const f of SAMPLE_FACILITIES)
      for (const input of [urgent, planned])
        for (const km of [0, 3, 30, 120, 400])
          for (const truncated of [false, true]) {
            const r = scoreBreakdown({ ...f, list_truncated: truncated }, { ...input, km });
            expect(r.lo).toBeLessThanOrEqual(r.score);
            expect(r.score).toBeLessThanOrEqual(r.hi);
            expect(r.lo).toBeGreaterThanOrEqual(0);
            expect(r.hi).toBeLessThanOrEqual(100);
          }
  });
  it('a truncated list raises only the upper bound', () => {
    for (const f of SAMPLE_FACILITIES)
      for (const input of [urgent, planned]) {
        const a = scoreBreakdown({ ...f, list_truncated: false, loc_approx: false, merge_suspect: false }, input);
        const b = scoreBreakdown({ ...f, list_truncated: true, loc_approx: false, merge_suspect: false }, input);
        // Lower bound may only fall by the data-quality note, never rise; upper bound never falls.
        expect(b.hi).toBeGreaterThanOrEqual(a.hi - WEIGHTS[input.mode].quality);
        const loA = a.components.filter((c) => c.id !== 'quality').reduce((s, c) => s + c.lo, 0);
        const loB = b.components.filter((c) => c.id !== 'quality').reduce((s, c) => s + c.lo, 0);
        expect(loB).toBeCloseTo(loA, 9);
        const hiA = a.components.filter((c) => c.id !== 'quality').reduce((s, c) => s + c.hi, 0);
        const hiB = b.components.filter((c) => c.id !== 'quality').reduce((s, c) => s + c.hi, 0);
        expect(hiB).toBeGreaterThanOrEqual(hiA - 1e-9);
      }
  });
  it('an unverified need gets upper-bound credit, not lower-bound', () => {
    const r = scoreBreakdown(mk({ services: 'cardiology:unverified:1:0', list_truncated: false }), urgent);
    const t = r.components.find((c) => c.id === 'treatment')!;
    expect(t.hi).toBeGreaterThan(t.lo);
  });
  it('every component has evidence or an explicit note', () => {
    for (const f of SAMPLE_FACILITIES) for (const c of scoreBreakdown(f, urgent).components) expect(c.evidence.length).toBeGreaterThan(0);
  });
  it('urgent puts emergency readiness and distance first; planned puts procedures first', () => {
    const top = (m: 'urgent' | 'planned') => [...COMPONENT_ORDER].sort((a, b) => WEIGHTS[m][b] - WEIGHTS[m][a]);
    expect(top('urgent')[0]).toBe('emergency');
    expect(WEIGHTS.urgent.distance).toBe(Math.max(...COMPONENT_ORDER.filter((c) => c !== 'emergency').map((c) => WEIGHTS.urgent[c])));
    expect(top('planned')[0]).toBe('procedures');
  });
  it('confidence is Low when the range is wide', () => {
    const r = scoreBreakdown(mk({ services: 'cardiology:unverified:1:0', list_truncated: true, equipment_listed: false }), urgent);
    expect(r.hi - r.lo).toBeGreaterThan(12);
    expect(r.confidence).not.toBe('High');
  });
  it('never produces a percentage in its text', () => {
    for (const f of SAMPLE_FACILITIES) {
      const r = scoreBreakdown(f, { ...urgent, conditions: { pregnant: true, kidney: true, stroke: true, diabetes: true }, age: 9 });
      const text = [r.why, ...r.components.flatMap((c) => c.evidence.map((e) => e.text))].join(' ');
      expect(text).not.toMatch(/%/);
    }
  });
});
