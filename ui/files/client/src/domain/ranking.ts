import { CATH_LAB_LABELS, parseLabelEvidence, type LabelCode } from './labels';
import { haversineKm, type Point } from './geo';
import { topWarnings, allWarnings, type DataWarning, type WarningId } from './warnings';
import type { Conditions, Facility, Mode } from './types';
import { scoreBreakdown, type ScoreResult } from './score';

/**
 * Order = match score (domain/score.ts: weighted components with a score range), highest first,
 * then distance. The evidence tiers below are still computed and shown on each card.
 * (Earlier versions sorted lexicographically by these keys; see DECISION_LOG.)
 * Each place gets an EVIDENCE TIER for the care the user needs:
 *   A  listed in service text AND backed (named in 2+ fields, or cath-lab / ICU equipment listed)
 *   B  listed in service text only
 *   C  only a specialty tag ("cardiology"), no service described
 *   D  does not list the care needed (still shown, last; lists are cut at 50 items so it may exist)
 * Sort keys, in order (every key is explainable in words):
 *   urgent : lists-it (A/B before C/D) -> emergency backing -> distance band -> tier -> serious warnings -> conditions -> km
 *   planned: tier -> serious warnings -> conditions -> km
 * A fact affects ONE key only (no double counting). Unknown (truncated list) is never treated as "missing".
 * Conditions never hide a place: they only order places that are otherwise tied.
 */
export type Tier = 'A' | 'B' | 'C' | 'D';
export type EmergencyBacking = 'backed' | 'claimed' | 'none';

export const SERIOUS_WARNINGS: readonly WarningId[] = ['merged', 'location_approx', 'large_procedure_small_facility', 'emergency_not_backed'];
export const DISTANCE_BANDS_KM = [25, 50, 100, 250] as const;

export type ConditionHit = 'child' | 'pregnant_obgyn' | 'pregnant_nicu' | 'kidney' | 'stroke' | 'diabetes';

export interface RankInput {
  mode: Mode;
  origin: Point;
  wantedLabels: readonly LabelCode[];
  conditions: Conditions;
  age: number | null;
  unit?: 'km' | 'mi';
}

export interface Ranked {
  mode: Mode;
  facility: Facility;
  km: number;
  tier: Tier;
  /** Wanted labels this place lists, best evidence first. */
  matched: { label: LabelCode; tier: Exclude<Tier, 'D'> }[];
  emergency: EmergencyBacking;
  seriousWarnings: number;
  conditionHits: ConditionHit[];
  warnings: DataWarning[];
  /** Match score 0-100 with range, confidence and per-component evidence. */
  score: ScoreResult;
}

const TIER_ORDER: Record<Tier, number> = { A: 0, B: 1, C: 2, D: 3 };
const EM_ORDER: Record<EmergencyBacking, number> = { backed: 0, claimed: 1, none: 2 };

export function distanceBand(km: number): number {
  const i = DISTANCE_BANDS_KM.findIndex((b) => km <= b);
  return i < 0 ? DISTANCE_BANDS_KM.length : i;
}

function labelTier(f: Facility, label: LabelCode, ev: { fields: number; text: boolean }): Exclude<Tier, 'D'> {
  if (!ev.text) return 'C';
  const equipment = (CATH_LAB_LABELS.includes(label) && f.cath_equipment) || (label === 'L09' && f.icu_equipment);
  return ev.fields >= 2 || equipment ? 'A' : 'B';
}

export function scoreFacility(f: Facility, input: RankInput): Ranked {
  const km = haversineKm(input.origin, { lat: f.lat, lon: f.lon });
  const evidence = parseLabelEvidence(f.label_fields);
  const wanted = input.wantedLabels.length > 0 ? input.wantedLabels : [...evidence.keys()];
  const matched = wanted
    .filter((l) => evidence.has(l))
    .map((l) => ({ label: l, tier: labelTier(f, l, evidence.get(l) ?? { fields: 1, text: false }) }))
    .sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier]);
  const tier: Tier = matched[0]?.tier ?? 'D';
  const emergency: EmergencyBacking = f.emergency_claim ? (f.ambulance || f.icu_equipment ? 'backed' : 'claimed') : 'none';
  const all = allWarnings(f);
  const seriousWarnings = all.filter((w) => SERIOUS_WARNINGS.includes(w.id) && (w.id !== 'emergency_not_backed' || input.mode === 'urgent')).length;
  const conditionHits: ConditionHit[] = [];
  if (input.age !== null && input.age < 18 && evidence.has('L11')) conditionHits.push('child');
  if (input.conditions.pregnant && f.has_obgyn) conditionHits.push('pregnant_obgyn');
  if (input.conditions.pregnant && f.has_nicu) conditionHits.push('pregnant_nicu');
  if (input.conditions.kidney && f.has_dialysis) conditionHits.push('kidney');
  if (input.conditions.stroke && f.has_neuro_stroke) conditionHits.push('stroke');
  if (input.conditions.diabetes && f.has_diabetes_care) conditionHits.push('diabetes');
  const score = scoreBreakdown(f, { mode: input.mode, km, wantedLabels: input.wantedLabels, conditions: input.conditions, age: input.age, unit: input.unit });
  return { mode: input.mode, facility: f, km, tier, matched, emergency, seriousWarnings, conditionHits, warnings: topWarnings(f), score };
}

export function compareRanked(a: Ranked, b: Ranked): number {
  if (a.score.score !== b.score.score) return b.score.score - a.score.score;
  if (a.km !== b.km) return a.km - b.km;
  return a.facility.unique_id.localeCompare(b.facility.unique_id);
}

/** The earlier lexicographic order, kept for comparison in tests and the decision log. */
export function compareLexicographic(a: Ranked, b: Ranked): number {
  const lists = (r: Ranked) => (r.tier === 'A' || r.tier === 'B' ? 0 : 1);
  const keys = (r: Ranked): number[] =>
    r.mode === 'urgent'
      ? [lists(r), EM_ORDER[r.emergency], distanceBand(r.km), TIER_ORDER[r.tier], r.seriousWarnings, -r.conditionHits.length, r.km]
      : [TIER_ORDER[r.tier], r.seriousWarnings, -r.conditionHits.length, r.km];
  const ka = keys(a);
  const kb = keys(b);
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
  return a.facility.unique_id.localeCompare(b.facility.unique_id);
}

/** Ranks every candidate; conditions only order ties, they never remove a place. */
export function rankFacilities(list: readonly Facility[], input: RankInput): Ranked[] {
  return list.map((f) => scoreFacility(f, input)).sort(compareRanked);
}

/** Places whose evidence is good enough to stop widening the search radius. */
export const isRelevant = (r: Ranked) => r.tier === 'A' || r.tier === 'B';
