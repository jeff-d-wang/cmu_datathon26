import { describe, expect, test } from 'vitest';
import { compareRanked, distanceBand, isRelevant, rankFacilities, scoreFacility, type RankInput } from './ranking';
import { chooseRadius, coarseBBox, haversineKm } from './geo';
import { allWarnings, topWarnings } from './warnings';
import { SAMPLE_FACILITIES, SAMPLE_PLACES } from '../sample/sampleData';
import { searchPlaces } from './places';
import { detectSymptoms } from './symptoms';
import type { Facility } from './types';
import type { Need } from './services';

const origin = { lat: 18.4386, lon: 79.1288 };
const noCond = { pregnant: false, kidney: false, stroke: false, diabetes: false };
const need = (service: Need['service'], critical = false, weight = 1): Need => ({ service, weight, critical });
const urgent: RankInput = { mode: 'urgent', origin, needs: [need('interventionalCardiology'), need('icu'), need('cardiology', false, 0.8)], conditions: noCond, age: 52 };
const planned: RankInput = { ...urgent, mode: 'planned', needs: [need('cardiothoracicSurgery'), need('interventionalCardiology')] };
const byId = (id: string) => SAMPLE_FACILITIES.find((f) => f.unique_id === id)!;
const mk = (over: Partial<Facility>): Facility => ({ ...byId('s-c'), small_facility: false, ...over });

describe('evidence tiers (bands)', () => {
  test('high band is tier A, medium is tier B, unverified is tier C', () => {
    const hi = mk({ unique_id: 'x', services: 'cardiothoracicSurgery:high:3:0' });
    const med = mk({ unique_id: 'x', services: 'cardiothoracicSurgery:medium:2:1' });
    const unv = mk({ unique_id: 'x', services: 'cardiothoracicSurgery:unverified:1:0' });
    expect(scoreFacility(hi, planned).tier).toBe('A');
    expect(scoreFacility(med, planned).tier).toBe('B');
    expect(scoreFacility(unv, planned).tier).toBe('C');
  });
  test('a low band (contradicted by facility size) is tier D', () => {
    expect(scoreFacility(mk({ unique_id: 'x', services: 'cardiology:low:1:0' }), urgent).tier).toBe('D');
  });
  test('a place that does not evidence the wanted care is tier D but is still returned', () => {
    const r = rankFacilities(SAMPLE_FACILITIES, { ...planned, needs: [need('physicalMedicineAndRehabilitation')] });
    expect(r).toHaveLength(SAMPLE_FACILITIES.length);
    expect(r[r.length - 1].tier).toBe('D');
  });
  test('critical need without high/medium evidence excludes the facility (hard filter)', () => {
    const r = rankFacilities(SAMPLE_FACILITIES, { ...planned, needs: [need('dialysis', true)] });
    expect(r.map((x) => x.facility.unique_id).sort()).toEqual(['s-b', 's-f']);
  });
});

describe('ordering', () => {
  test('deterministic', () => {
    const a = rankFacilities(SAMPLE_FACILITIES, urgent).map((r) => r.facility.unique_id);
    expect(rankFacilities(SAMPLE_FACILITIES, urgent).map((r) => r.facility.unique_id)).toEqual(a);
  });
  test('planned: a well-evidenced place ~60 km away outranks a nearer unverified one (procedure evidence weighs most)', () => {
    const near = mk({ unique_id: 'near', lat: 18.44, lon: 79.13, services: 'cardiothoracicSurgery:unverified:1:0' });
    const far = mk({ unique_id: 'far', lat: 18.95, lon: 79.4, services: 'cardiothoracicSurgery:high:3:0' });
    expect(rankFacilities([near, far], { ...planned, needs: [need('cardiothoracicSurgery')] })[0].facility.unique_id).toBe('far');
  });
  test('same tier: shorter distance wins', () => {
    const a = mk({ unique_id: 'a', lat: 18.45, lon: 79.13, services: 'cardiothoracicSurgery:medium:2:1' });
    const b = mk({ unique_id: 'b', lat: 18.9, lon: 79.5, services: 'cardiothoracicSurgery:medium:2:1' });
    expect(rankFacilities([b, a], planned)[0].facility.unique_id).toBe('a');
  });
  test('urgent: emergency backed by ambulance/ICU equipment comes before an unbacked claim in the same band', () => {
    const backed = mk({ unique_id: 'backed', lat: 18.5, lon: 79.2, services: 'cardiology:medium:2:1', emergency_quote: '24 hour emergency', ambulance: true });
    const claimed = mk({ unique_id: 'claimed', lat: 18.45, lon: 79.14, services: 'cardiology:medium:2:1', emergency_quote: '24 hour emergency' });
    expect(rankFacilities([claimed, backed], urgent)[0].facility.unique_id).toBe('backed');
  });
  test('conditions boost, never hide: the matching place gains points and both stay listed', () => {
    const strong = mk({ unique_id: 's', services: 'cardiothoracicSurgery:high:2:1' });
    const weakWithDialysis = mk({ unique_id: 'w', services: 'cardiothoracicSurgery:medium:1:0|dialysis:high:2:0' });
    const input = { ...planned, conditions: { ...noCond, kidney: true } };
    const r = rankFacilities([weakWithDialysis, strong], input);
    expect(r).toHaveLength(2);
    const w = r.find((x) => x.facility.unique_id === 'w')!;
    expect(w.conditionHits).toContain('kidney');
    expect(w.score.components.find((c) => c.id === 'accommodate')!.lo).toBe(10);
    const without = rankFacilities([weakWithDialysis], planned)[0];
    expect(w.score.score).toBeGreaterThanOrEqual(without.score.score);
  });
  test('under-18 records the children’s-care hit', () => {
    expect(scoreFacility(byId('s-e'), { ...planned, age: 9 }).conditionHits).toContain('child');
  });
  test('compareRanked is antisymmetric on the sample', () => {
    const r = rankFacilities(SAMPLE_FACILITIES, urgent);
    expect(Math.sign(compareRanked(r[0], r[1]))).toBe(-Math.sign(compareRanked(r[1], r[0])));
  });
  test('distance bands', () => {
    expect([10, 25, 26, 99, 249, 300].map(distanceBand)).toEqual([0, 0, 1, 2, 3, 4]);
  });
  test('relevance for widening uses tiers A/B only', () => {
    expect(isRelevant(scoreFacility(byId('s-d'), urgent))).toBe(false);
  });
});

describe('warnings', () => {
  test('at most two, in the fixed order', () => {
    expect(topWarnings(byId('s-d')).map((x) => x.id)).toEqual(['location_approx', 'scale_mismatch']);
  });
  test('a low-band service (contradicted by facility size) is flagged', () => {
    expect(allWarnings(byId('s-d')).map((w) => w.id)).toContain('scale_mismatch');
  });
  test('a needed service with only a single unverified mention is flagged', () => {
    expect(topWarnings(byId('s-c'), [need('echocardiography')]).map((w) => w.id)).toContain('unverified_need');
  });
});

describe('geo, place search and symptoms', () => {
  test('haversine Hyderabad to Karimnagar is about 140 km', () => {
    const d = haversineKm({ lat: 17.385, lon: 78.4867 }, origin);
    expect(d).toBeGreaterThan(130);
    expect(d).toBeLessThan(150);
  });
  test('bbox is rounded outward to a 0.5 degree grid', () => {
    const b = coarseBBox(origin, 25);
    for (const v of [b.minLat, b.maxLat, b.minLon, b.maxLon]) expect((v * 2) % 1).toBe(0);
    expect(b.minLat).toBeLessThan(origin.lat);
    expect(b.maxLon).toBeGreaterThan(origin.lon);
  });
  test('radius widens 25 -> 50 -> 100 -> 250', () => {
    expect(chooseRadius([5, 10, 12, 20, 24])).toEqual({ radiusKm: 25, widened: false });
    expect(chooseRadius([5, 40, 45, 48, 49])).toEqual({ radiusKm: 50, widened: true });
    expect(chooseRadius([300])).toEqual({ radiusKm: 250, widened: true });
  });
  test('spelling-tolerant search finds Karimnagar from "karimnager"', () => {
    expect(searchPlaces(SAMPLE_PLACES, 'karimnager').map((p) => p.district)).toContain('KARIMNAGAR');
  });
  test('PIN prefix search', () => {
    expect(searchPlaces(SAMPLE_PLACES, '5050')[0].code).toBe('505001');
  });
  test('Hinglish chest-pain wording maps to chest pressure (DRAFT keywords)', () => {
    expect(detectSymptoms('kal se seene mein dard hai', [])).toContain('chest_pressure');
  });
});
