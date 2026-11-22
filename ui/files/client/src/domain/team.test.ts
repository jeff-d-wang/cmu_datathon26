import { describe, expect, it } from 'vitest';
import { bannerText, teamCompare, teamLadder, toTeamRow, type TeamRow } from './team';

const row = (o: Partial<TeamRow>): TeamRow => ({ unique_id: 'a', name: 'A', facility_class: 'clinic', km: 10, coord_source: 'x', lat: 0, lon: 0, nabh: false, beds: null, n_needs_met: 1, matched: {}, score: 1, crit_fail: false, ...o });
const order = (rs: TeamRow[]) => [...rs].sort(teamCompare).map((r) => r.unique_id);

describe('teamCompare', () => {
  it('orders score, nabh, beds, class, km', () => {
    expect(order([row({ unique_id: 'a' }), row({ unique_id: 'b', score: 2 })])).toEqual(['b', 'a']);
    expect(order([row({ unique_id: 'a' }), row({ unique_id: 'b', nabh: true })])).toEqual(['b', 'a']);
    expect(order([row({ unique_id: 'a', beds: 5 }), row({ unique_id: 'b', beds: 50 }), row({ unique_id: 'c', beds: null })])).toEqual(['b', 'a', 'c']);
    expect(order([row({ unique_id: 'a', facility_class: null }), row({ unique_id: 'b', facility_class: 'hospital' }), row({ unique_id: 'c', facility_class: 'pharmacy' })])).toEqual(['b', 'c', 'a']);
    expect(order([row({ unique_id: 'a', km: 9 }), row({ unique_id: 'b', km: 3 })])).toEqual(['b', 'a']);
    expect(order([row({ unique_id: 'b' }), row({ unique_id: 'a' })])).toEqual(['a', 'b']);
  });
});

describe('teamLadder', () => {
  it('widens', () => {
    const l = teamLadder([row({ km: 60 })]);
    expect(l.radiusKm).toBe(100);
    expect(l.mode).toBe('normal');
    expect(l.banners).toEqual(['no ranked match within 25 km; widened search', 'no ranked match within 50 km; widened search']);
  });
  it('softens when all crit_fail', () => {
    const l = teamLadder([row({ km: 30, crit_fail: true })]);
    expect(l.mode).toBe('softened');
    expect(l.radiusKm).toBe(50);
    expect(l.banners).toHaveLength(5);
    expect(l.banners[4]).toMatch(/^CRITICAL_UNAVAILABLE/);
  });
  it('empty', () => {
    expect(teamLadder([row({ km: 400 })]).mode).toBe('empty');
    expect(teamLadder([]).rows).toEqual([]);
  });
});

describe('toTeamRow / bannerText', () => {
  it('parses strings', () => {
    const r = toTeamRow({ unique_id: 'x', name: 'N', facility_class: null, km: '3.5', nabh: 'true', beds: '12', n_needs_met: '2', score: '1.5', crit_fail: 'false', matched_json: '{"a":"high"}' });
    expect(r).toMatchObject({ km: 3.5, nabh: true, beds: 12, n_needs_met: 2, score: 1.5, crit_fail: false, facility_class: null, matched: { a: 'high' } });
    expect(toTeamRow({ beds: null }).beds).toBeNull();
  });
  it('plain banner', () => {
    expect(bannerText('no ranked match within 25 km; widened search')).toBe('Nothing matched within 25 km, so the search widened.');
  });
});
