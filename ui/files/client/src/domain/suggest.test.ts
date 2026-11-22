import { describe, expect, it } from 'vitest';
import { suggestSymptoms } from './symptoms';

const label = (id: string) => ({ chest_pressure: 'Chest pressure', breathless: 'Breathless', fainting: 'Fainting', racing_heartbeat: 'Racing heartbeat', swollen_legs: 'Swollen legs', unusual_tiredness: 'Unusual tiredness' } as Record<string, string>)[id] ?? id;

describe('suggestSymptoms', () => {
  it('needs at least 2 characters', () => {
    expect(suggestSymptoms('c', label)).toEqual([]);
  });
  it('label prefix ranks first', () => {
    expect(suggestSymptoms('br', label)[0].id).toBe('breathless');
  });
  it('matches everyday and Hinglish phrases and says which phrase matched', () => {
    const s = suggestSymptoms('short of', label)[0];
    expect(s.id).toBe('breathless');
    expect(s.via).toBe('short of breath');
    expect(suggestSymptoms('seene', label)[0].id).toBe('chest_pressure');
    expect(suggestSymptoms('dhadkan', label)[0].id).toBe('racing_heartbeat');
  });
  it('matches a word inside the label', () => {
    expect(suggestSymptoms('legs', label).map((s) => s.id)).toContain('swollen_legs');
  });
  it('excludes already-picked symptoms and gives one row per symptom', () => {
    const ids = suggestSymptoms('chest', label, ['chest_pressure']).map((s) => s.id);
    expect(ids).not.toContain('chest_pressure');
    const all = suggestSymptoms('chest', label).map((s) => s.id);
    expect(new Set(all).size).toBe(all.length);
  });
});

import { detectSymptoms, OWN_PREFIX } from './symptoms';
import { checkRedFlags } from './redflags';

const noSafety = { painAtRestOr15Min: false, sweatingNauseaFaint: false, breathlessAtRest: false, jawArmBackPain: false };

describe('wider symptom list', () => {
  it('finds symptoms beyond the six quick picks', () => {
    expect(suggestSymptoms('cough', (id) => id)[0].id).toBe('cough');
    expect(suggestSymptoms('chakkar', (id) => id)[0].id).toBe('dizziness');
    expect(suggestSymptoms('high bp', (id) => id)[0].id).toBe('high_bp');
  });
  it('own-words symptoms are still read by the keyword rules', () => {
    expect(detectSymptoms('', [OWN_PREFIX + 'my chest pain comes and goes'])).toContain('chest_pressure');
  });
  it('picking stroke signs always opens the Emergency screen', () => {
    expect(checkRedFlags({ safety: noSafety, freeText: '', symptomIds: ['stroke_signs'], age: 30, diabetes: false }).emergency).toBe(true);
    expect(checkRedFlags({ safety: noSafety, freeText: '', symptomIds: ['cough'], age: 30, diabetes: false }).emergency).toBe(false);
  });
});
