import symptomMap from '../../../config/symptom_map.json';
import { isServiceKey, type Need, type ServiceKey } from './services';

// DRAFT: needs clinician review. All symptom rules live in config/symptom_map.json.
export const SYMPTOM_MAP_STATUS: string = symptomMap.status;
export const SYMPTOM_IDS = symptomMap.symptoms.map((s) => s.id);
/** The common symptoms shown as one-tap buttons; the rest are found by typing. */
export const QUICK_PICK_IDS = symptomMap.symptoms
  .filter((s) => s.quick_pick)
  .sort((a, b) => ((b as { survey_visits?: number }).survey_visits ?? 0) - ((a as { survey_visits?: number }).survey_visits ?? 0))
  .map((s) => s.id);
/** Symptoms that always open the Emergency screen when picked (e.g. stroke signs). */
export const EMERGENCY_NOW_IDS: readonly string[] = symptomMap.symptoms.filter((s) => s.severity === 'EMERGENCY_NOW').map((s) => s.id);

/** A symptom typed in the user's own words that matches nothing in the list. Kept in the browser only. */
export const OWN_PREFIX = 'own:';
export const isOwnWords = (id: string) => id.startsWith(OWN_PREFIX);
export const ownWordsText = (id: string) => id.slice(OWN_PREFIX.length);

export function normalise(text: string): string {
  return text.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
}

/** Symptom ids found in free text (keyword rules, in-browser only) plus ticked chips. */
export function detectSymptoms(freeText: string, chips: readonly string[]): string[] {
  const t = normalise([freeText, ...chips.filter(isOwnWords).map(ownWordsText)].join(' '));
  const found = new Set(chips);
  for (const s of symptomMap.symptoms) {
    if (s.keywords.some((k) => t.includes(k))) found.add(s.id);
  }
  return [...found];
}

const TIER_WEIGHT: Record<string, number> = { EMERGENCY_NOW: 1, URGENT: 0.8, ROUTINE: 0.5 };

/**
 * Needs vector (service key + weight + critical) from Layer A symptom rules, built in the browser.
 * EMERGENCY_NOW symptoms mark their services critical: the ranking hard-filters on those.
 * Planned mode adds the planned surgery services as critical, weight 1.
 */
export function needsForSymptoms(symptomIds: readonly string[], mode: 'urgent' | 'planned'): Need[] {
  const weight = new Map<ServiceKey, number>();
  const critical = new Set<ServiceKey>();
  const bump = (k: ServiceKey, w: number) => weight.set(k, Math.max(weight.get(k) ?? 0, w));
  const matched = symptomMap.symptoms.filter((s) => symptomIds.includes(s.id));
  for (const s of matched) {
    const w = TIER_WEIGHT[s.severity] ?? 0.5;
    for (const k of s.labels) {
      if (!isServiceKey(k)) continue;
      bump(k, w);
      if (s.severity === 'EMERGENCY_NOW') critical.add(k);
    }
  }
  if (mode === 'planned') {
    for (const k of symptomMap.planned_surgery_labels) {
      if (isServiceKey(k)) { bump(k, 1); critical.add(k); }
    }
  }
  if (weight.size === 0) {
    for (const k of symptomMap.default_labels) {
      if (isServiceKey(k)) bump(k, 0.5);
    }
  }
  return [...weight.keys()].map((service) => ({ service, weight: weight.get(service) ?? 0.5, critical: critical.has(service) }));
}

export function adviceKey(symptomIds: readonly string[]): string | null {
  const hit = symptomMap.symptoms.find((s) => symptomIds.includes(s.id));
  return hit ? hit.advice : null;
}

export function showsEmergencyBannerFirst(symptomIds: readonly string[]): boolean {
  return symptomMap.symptoms.some((s) => symptomIds.includes(s.id) && s.emergency_banner_first === true);
}

export const RED_FLAG_KEYWORDS: readonly string[] = symptomMap.red_flag_keywords;
export const KNOWN_HEART_DISEASE_KEYWORDS: readonly string[] = symptomMap.known_heart_disease_keywords;

export interface SymptomSuggestion {
  id: string;
  label: string;
  /** The keyword that matched, when it is not the label itself (e.g. "short of breath" → Breathless). */
  via: string | null;
}

/**
 * Typeahead suggestions for the symptom box. In-browser only; nothing is sent anywhere.
 * Ranking: label starts with the query, then a keyword starts with it, then a word inside
 * the label or a keyword starts with it. One suggestion per symptom.
 */
export function suggestSymptoms(query: string, labelFor: (id: string) => string, exclude: readonly string[] = [], limit = 6): SymptomSuggestion[] {
  const q = normalise(query);
  if (q.length < 2) return [];
  const wordStart = (text: string) => text === q || text.startsWith(q) || text.includes(` ${q}`);
  const scored: { s: SymptomSuggestion; score: number }[] = [];
  for (const sym of symptomMap.symptoms) {
    if (exclude.includes(sym.id)) continue;
    const label = labelFor(sym.id);
    const l = normalise(label);
    let score = -1;
    let via: string | null = null;
    if (l.startsWith(q)) score = 0;
    else {
      const kwPrefix = sym.keywords.find((k) => k.startsWith(q));
      if (kwPrefix) { score = 1; via = kwPrefix; }
      else if (wordStart(l)) score = 2;
      else {
        const kwWord = sym.keywords.find((k) => wordStart(k));
        if (kwWord) { score = 3; via = kwWord; }
      }
    }
    if (score >= 0) scored.push({ s: { id: sym.id, label, via }, score });
  }
  return scored.sort((a, b) => a.score - b.score).slice(0, limit).map((x) => x.s);
}
