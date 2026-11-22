import { describe, expect, test } from 'vitest';
import { checkRedFlags, parseAge, type SafetyChecks } from './redflags';
import { detectSymptoms } from './symptoms';

const none: SafetyChecks = { painAtRestOr15Min: false, sweatingNauseaFaint: false, breathlessAtRest: false, jawArmBackPain: false };
const base = { safety: none, freeText: '', symptomIds: [] as string[], age: null as number | null, diabetes: false };

describe('red flags', () => {
  test('no input means no emergency', () => {
    expect(checkRedFlags(base).emergency).toBe(false);
  });
  test.each(Object.keys(none))('any single safety tick (%s) goes to emergency', (k) => {
    const r = checkRedFlags({ ...base, safety: { ...none, [k]: true } });
    expect(r.emergency).toBe(true);
    expect(r.reasons).toContain('safety_check');
  });
  test('red-flag keyword in free text goes to emergency', () => {
    const r = checkRedFlags({ ...base, freeText: 'Crushing pain and I am SWEATING' });
    expect(r.reasons).toContain('keyword');
  });
  test('chest pain + age >= 40 + diabetes goes to emergency', () => {
    const r = checkRedFlags({ ...base, symptomIds: ['chest_pressure'], age: 52, diabetes: true });
    expect(r.reasons).toEqual(['chest_pain_risk_profile']);
  });
  test('chest pain + age >= 40 + known heart disease in text goes to emergency', () => {
    const ids = detectSymptoms('chest pressure, I had a stent last year', []);
    expect(checkRedFlags({ ...base, freeText: 'chest pressure, I had a stent last year', symptomIds: ids, age: 61 }).emergency).toBe(true);
  });
  test('chest pain at 39 with diabetes does not trigger the risk-profile rule', () => {
    expect(checkRedFlags({ ...base, symptomIds: ['chest_pressure'], age: 39, diabetes: true }).emergency).toBe(false);
  });
  test('chest pain at 60 without diabetes or heart disease does not trigger it', () => {
    expect(checkRedFlags({ ...base, symptomIds: ['chest_pressure'], age: 60 }).emergency).toBe(false);
  });
});

describe('age parsing', () => {
  test.each([['', null, true], ['0', 0, true], ['120', 120, true], ['45', 45, true]])('"%s" is valid', (raw, age, ok) => {
    expect(parseAge(raw)).toEqual({ ok, age });
  });
  test.each(['121', '-1', '4.5', 'abc', '1000'])('"%s" is invalid', (raw) => {
    expect(parseAge(raw).ok).toBe(false);
  });
});
