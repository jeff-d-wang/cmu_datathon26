import { describe, expect, it } from 'vitest';
import { placeLabel, searchPlaces, type Place } from './places';

const pl = (kind: string, code: string, district: string, towns: string): Place => ({ kind, code, district, state: 'X', towns, lat: 0, lon: 0 });
const places: Place[] = [
  pl('district', '', 'NEW DELHI', ''),
  pl('district', '', 'SOUTH DELHI', ''),
  pl('district', '', 'KARIMNAGAR', ''),
  pl('district', '', 'JAIPUR', ''),
  pl('pin', '110001', 'NEW DELHI', 'Connaught Place, Parliament Street'),
  pl('pin', '110002', 'CENTRAL DELHI', 'Darya Ganj'),
];

describe('searchPlaces', () => {
  it('matches multi-word queries', () => {
    expect(searchPlaces(places, 'new delhi')[0].district).toBe('NEW DELHI');
    expect(searchPlaces(places, 'south delhi')[0].district).toBe('SOUTH DELHI');
  });
  it('matches single words and tolerates a typo', () => {
    expect(searchPlaces(places, 'karimnagar')[0].district).toBe('KARIMNAGAR');
    expect(searchPlaces(places, 'karimnager')[0].district).toBe('KARIMNAGAR');
  });
  it('matches a PIN and labels it short', () => {
    const r = searchPlaces(places, '110001');
    expect(r).toHaveLength(1);
    expect(placeLabel(r[0])).toBe('110001 · New Delhi');
  });
  it('returns nothing for unrelated text', () => {
    expect(searchPlaces(places, 'zzzzzz')).toEqual([]);
  });
});
