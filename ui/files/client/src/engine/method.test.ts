import { describe, expect, it } from 'vitest';
import { buildEvidence, chipsToQuery, distanceFactor, findComplaint, findFacilities, matchOf, MIN_MATCH, run, splitRelevant, tierOf, trustOf, type EngineFacility } from './method';

const fac = (o: Partial<EngineFacility> = {}): EngineFacility => ({
  id: 'x', name: 'Test Hospital', city: 'Jaipur', state: 'Rajasthan', pin: '302001', facility_type: 'hospital', capacity: null,
  lat: 26.92, lon: 75.81, centroid_lat: 26.92, centroid_lon: 75.81, pincode_matched: true, phone: '', website: '',
  specialties: [], procedure: [], equipment: [], capability: [], description: '', ...o,
});

describe('complaint matcher (notebook cases)', () => {
  it('chest pain -> 1050', () => expect(findComplaint('chest pain')[0][2]).toBe(1050));
  it('code text is a code', () => expect(run('1050', 26.92, 75.81, []).label).toMatch(/^Chest pain/));
  it('stroke wording routes to the stroke guideline, critical, no CI', () => {
    const r = run('stroke symptoms, face drooping', 26.92, 75.81, [fac()]);
    expect(r.label).toMatch(/Stroke/);
    expect(r.meta.critical).toBe(true);
    expect(r.needs[0]).toEqual(['icu', 0.35, null, null]);
    expect(r.tolerance_km).toBe(15);
  });
  it('poisoning', () => expect(run('child swallowed too many pills', 26.92, 75.81, []).label).toMatch(/Poisoning/));
  it('dialysis is not critical: tau 40', () => {
    const r = run('need dialysis for kidney failure', 26.92, 75.81, []);
    expect(r.label).toMatch(/Dialysis/);
    expect(r.tolerance_km).toBe(40);
  });
  it('gibberish falls back, LOW, never errors', () => {
    const r = run('uneasy since yesterday', 26.92, 75.81, [fac()]);
    expect(r.label).toMatch(/fallback/);
    expect(r.source).toBe('generic fallback');
    expect(() => run('', 26.92, 75.81, [])).not.toThrow();
  });
  it('unknown numeric code throws', () => expect(() => run('12345', 1, 1, [])).toThrow());
});

describe('chips to query', () => {
  it('maps chips; own words pass through when no chip maps', () => {
    expect(chipsToQuery(['chest_pressure'], '')).toBe('chest pain');
    expect(chipsToQuery(['chest_pressure', 'stroke_signs'], 'x')).toBe('stroke symptoms, face drooping');
    expect(chipsToQuery([], ' low back pain ')).toBe('low back pain');
  });
});

describe('distance, tiers', () => {
  it('distance factor tau 15 at 5.6 km', () => expect(distanceFactor(5.6, 15)).toBeCloseTo(0.878, 3));
  it('tiers: HIGH >= 0.65, MEDIUM >= 0.40', () => {
    expect([tierOf(0.65), tierOf(0.64), tierOf(0.4), tierOf(0.39)]).toEqual(['HIGH', 'MEDIUM', 'MEDIUM', 'LOW']);
  });
});

describe('evidence grading on synthetic records', () => {
  it('two fields = multi 1.0, one = single 0.7, quote capped at 100', () => {
    const ev = buildEvidence(fac({ equipment: ['ECG machine'], capability: ['unrelated text'], procedure: ['Emergency services ' + 'y'.repeat(200)] }));
    expect(ev.value.ecg).toBe(0.7);
    expect(ev.value.emergency).toBe(0.7);
    expect(ev.quote.emergency.length).toBe(100);
    const multi = buildEvidence(fac({ equipment: ['CT scanner'], description: 'We run a 24x7 emergency and CT unit' }));
    expect(multi.value.ct).toBe(1.0);
    expect(multi.quote.ct).toBe('CT scanner');
  });
  it('exclusions and GLOBAL_EXCLUDE reject items', () => {
    expect(buildEvidence(fac({ equipment: ['Dental X-ray (OPG)'] })).value.xray).toBeUndefined();
    expect(buildEvidence(fac({ capability: ['ICU not available'] })).value.icu).toBeUndefined();
    expect(buildEvidence(fac({ capability: ['Cath lab'] })).value.lab).toBeUndefined();
  });
  it('structured_field 0.5 for inpatient from type; tag_only 0.3 from specialties', () => {
    const ev = buildEvidence(fac({ specialties: ['Cardiology'], capacity: 100 }));
    expect(ev.value.inpatient).toBe(0.5);
    expect(ev.status.ecg).toBe('tag_only');
    expect(ev.value.ecg).toBe(0.3);
    expect(ev.quote.ecg).toBe('cardiology');
    expect(buildEvidence(fac({ facility_type: 'clinic', capacity: null })).value.inpatient).toBeUndefined();
  });
});

describe('match, trust, contract', () => {
  it('match blends 0.7 eval + 0.3 care; escalation is half the care term', () => {
    const shares = { emergency: 1, inpatient: 1 };
    expect(matchOf(shares, { emergency: 1, inpatient: 1 }, null).match).toBeCloseTo(1, 9);
    expect(matchOf(shares, { emergency: 1, cath_lab: 1 }, { tags: [], focus: [], escalation: 'cath_lab' }).match).toBeCloseTo(0.7 + 0.3 * 0.5, 9);
  });
  it('trust: no PIN match 0.85, 30 km 0.85, 120 km 0.6', () => {
    expect(trustOf(fac({ pincode_matched: false })).trust).toBe(0.85);
    expect(trustOf(fac({ centroid_lat: 27.2 })).trust).toBe(0.85);
    expect(trustOf(fac({ centroid_lat: 28.1 })).trust).toBe(0.6);
    expect(trustOf(fac()).flags).toEqual([]);
  });
  it('returns {label, needs, results, meta}; critical + all LOW gets the EMERGENCY FIRST advisory; topK respected', () => {
    const r = findFacilities('stroke', 26.92, 75.81, [fac({ id: 'a' }), fac({ id: 'b' })], 1);
    expect(Object.keys(r)).toEqual(['label', 'needs', 'results', 'meta']);
    expect(r.results).toHaveLength(1);
    expect(r.meta.advisory.startsWith('EMERGENCY FIRST - ')).toBe(true);
  });
  it('chest pain needs: emergency first, CI present', () => {
    const r = findFacilities('chest pain', 26.92, 75.81, []);
    expect(r.needs[0][0]).toBe('emergency');
    expect(r.needs[0][2]).not.toBeNull();
    expect(r.meta.advisory).toMatch(/^If this is sudden or severe/);
  });
});

describe('user-visible strings carry no attribution or country wording', () => {
  const BAD = /\bUS\b|U\.S\.|United States|Alvin/i;
  it.each(['chest pain', 'stroke symptoms, face drooping', 'need dialysis for kidney failure', 'uneasy since yesterday', 'child swallowed too many pills', 'low back pain'])('%s', (q) => {
    const r = run(q, 26.92, 75.81, [fac()]);
    const strings = [r.label, r.source, r.meta.advisory, ...r.alternates, ...r.results.flatMap((x) => [...x.confidence_reasons, x.relevance_reason, ...x.location_flags])];
    for (const s of strings) expect(s).not.toMatch(BAD);
  });
});

describe('splitRelevant', () => {
  it('splits at MIN_MATCH, keeps order, drops nothing', () => {
    const rs = [{ id: 'a', match: 0.9 }, { id: 'b', match: 0.19 }, { id: 'c', match: MIN_MATCH }, { id: 'd', match: 0 }];
    const { relevant, weak } = splitRelevant(rs, MIN_MATCH);
    expect(relevant.map((r) => r.id)).toEqual(['a', 'c']);
    expect(weak.map((r) => r.id)).toEqual(['b', 'd']);
  });
});
