import { describe, expect, it } from 'vitest';
import data from '../survey/complaint_profiles.json';
import { CHIP_TO_COMPLAINT, surveyFor } from './survey';

describe('surveyFor', () => {
  it('returns sorted, capped services for chest pressure', () => {
    const r = surveyFor(['chest_pressure']);
    expect(r?.code).toBe(1050);
    expect(r!.services.length).toBeLessThanOrEqual(6);
    const shares = r!.services.map((s) => s.share);
    expect(shares).toEqual([...shares].sort((a, b) => b - a));
  });
  it('returns null for unknown chips', () => {
    expect(surveyFor(['nope'])).toBeNull();
  });
  it('every mapped code exists in the profiles', () => {
    for (const code of Object.values(CHIP_TO_COMPLAINT)) expect(Object.keys(data.profiles)).toContain(String(code));
  });
});
