import { describe, expect, it } from 'vitest';
import { corroborationRule, ruleText } from './services';

describe('corroborationRule', () => {
  it('returns the registry arrays', () => {
    const r = corroborationRule('angioplasty');
    expect(r?.required).toEqual(['cathLab']);
    expect(r?.supporting).toContain('cardiology');
    expect(r?.minFacilityClass).toBe('hospital');
  });
  it('returns null when a service has no rule', () => {
    expect(corroborationRule('ayushmanBharatEmpanelled')).toBeNull();
    expect(corroborationRule('notAService')).toBeNull();
  });
});

describe('ruleText', () => {
  it('builds plain words', () => {
    const t = ruleText('angioplasty', 1);
    expect(t).toContain('Needs to also list:');
    expect(t).toContain('Expected at a hospital or larger');
    expect(t).toContain('(1 required item(s) missing in this record)');
    expect(ruleText('angioplasty')).not.toContain('missing');
    expect(ruleText('ayushmanBharatEmpanelled')).toBe('');
  });
});
