import { EMERGENCY_NOW_IDS, KNOWN_HEART_DISEASE_KEYWORDS, RED_FLAG_KEYWORDS, normalise } from './symptoms';

export interface SafetyChecks {
  painAtRestOr15Min: boolean;
  sweatingNauseaFaint: boolean;
  breathlessAtRest: boolean;
  jawArmBackPain: boolean;
}

export interface RedFlagInput {
  safety: SafetyChecks;
  freeText: string;
  symptomIds: readonly string[];
  age: number | null;
  diabetes: boolean;
}

export type RedFlagReason = 'safety_check' | 'keyword' | 'chest_pain_risk_profile' | 'emergency_symptom';

/**
 * Sends the user to the Emergency screen (no facility list) when ANY rule fires.
 * Deliberately conservative: keyword rules do not understand negation ("no chest pain"),
 * so they err towards emergency. DRAFT: needs clinician review.
 */
export function checkRedFlags(input: RedFlagInput): { emergency: boolean; reasons: RedFlagReason[] } {
  const reasons: RedFlagReason[] = [];
  const s = input.safety;
  if (s.painAtRestOr15Min || s.sweatingNauseaFaint || s.breathlessAtRest || s.jawArmBackPain) reasons.push('safety_check');
  const t = normalise(input.freeText);
  if (t && RED_FLAG_KEYWORDS.some((k) => t.includes(k))) reasons.push('keyword');
  const chestPain = input.symptomIds.includes('chest_pressure');
  // A picked symptom marked EMERGENCY_NOW in config/symptom_map.json (e.g. stroke signs) always opens the Emergency screen.
  if (input.symptomIds.some((id) => EMERGENCY_NOW_IDS.includes(id))) reasons.push('emergency_symptom');
  const knownHeartDisease = KNOWN_HEART_DISEASE_KEYWORDS.some((k) => t.includes(k));
  if (chestPain && input.age !== null && input.age >= 40 && (input.diabetes || knownHeartDisease)) {
    reasons.push('chest_pain_risk_profile');
  }
  return { emergency: reasons.length > 0, reasons };
}

/** Age must be a whole number 0-120; blank is allowed (null). */
export function parseAge(raw: string): { ok: boolean; age: number | null } {
  const v = raw.trim();
  if (v === '') return { ok: true, age: null };
  if (!/^\d{1,3}$/.test(v)) return { ok: false, age: null };
  const n = Number(v);
  return n >= 0 && n <= 120 ? { ok: true, age: n } : { ok: false, age: null };
}

/**
 * Explicit "this is happening now" answers: a safety-check tick, or picking an EMERGENCY_NOW
 * symptom (stroke signs). Only these open the Emergency screen on their own. Softer signals
 * (a worrying word in the text, the chest-pain risk profile) show an inline warning with a
 * button to emergency help, so the flow is not hijacked by a substring match.
 */
export const HARD_REASONS: readonly RedFlagReason[] = ['safety_check', 'emergency_symptom'];
export const isHardFlag = (reasons: readonly RedFlagReason[]) => reasons.some((r) => HARD_REASONS.includes(r));
/** Red-flag words found in the text, to show the user why we are warning them. */
export const redFlagWordsIn = (text: string) => RED_FLAG_KEYWORDS.filter((k) => normalise(text).includes(k));
