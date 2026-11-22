import { bandTier, confScore, CONDITION_SERVICES, CHILD_SERVICES, parseServices, passesCriticalFilter, type Band, type Need, type ServiceEvidence, type ServiceKey } from './services';
import { haversineKm, type Point } from './geo';
import { topWarnings, allWarnings, type DataWarning, type WarningId } from './warnings';
import type { Conditions, Facility, Mode } from './types';
import { scoreBreakdown, type ScoreResult } from './score';

/**
 * Order = match score (domain/score.ts: weighted components over confidence
 * bands), highest first, then distance.
 * CRITICAL-NEED HARD FILTER (user decision): a facility missing high/medium
 * evidence for a critical need is EXCLUDED before ranking (low/unverified/
 * absent all exclude). Non-critical needs only order, never remove.
 * Each place still gets an EVIDENCE TIER for the care the user needs:
 *   A  high band   B  medium band   C  unverified (single mention)
 *   D  no evidence (unknown, not disproven; lists are cut at 50 items)
 * Conditions never hide a place: they only order places that are otherwise tied.
 */
export type Tier = 'A' | 'B' | 'C' | 'D';
export type EmergencyBacking = 'backed' | 'claimed' | 'none';

export const SERIOUS_WARNINGS: readonly WarningId[] = ['merged', 'location_approx', 'scale_mismatch', 'emergency_not_backed'];
export const DISTANCE_BANDS_KM = [25, 50, 100, 250] as const;

export type ConditionHit = 'child' | 'pregnant_obgyn' | 'pregnant_nicu' | 'kidney' | 'stroke' | 'diabetes';

export interface RankInput {
  mode: Mode;
  origin: Point;
  /** Weighted need vector (LLM extraction or symptom map). Critical needs are hard filters. */
  needs: readonly Need[];
  conditions: Conditions;
  age: number | null;
  unit?: 'km' | 'mi';
}

export interface Ranked {
  mode: Mode;
  facility: Facility;
  km: number;
  tier: Tier;
  /** Needed services this place evidences, best band first. */
  matched: { service: ServiceKey; band: Band; tier: Exclude<Tier, 'D'> }[];
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

function hasAny(svcs: Map<ServiceKey, ServiceEvidence>, keys: readonly ServiceKey[]): boolean {
  return keys.some((k) => svcs.has(k));
}

export function scoreFacility(f: Facility, input: RankInput): Ranked {
  const km = haversineKm(input.origin, { lat: f.lat, lon: f.lon });
  const svcs = parseServices(f.services);
  const wanted: ServiceKey[] = input.needs.length > 0 ? input.needs.map((n) => n.service) : [...svcs.keys()];
  const matched = wanted
    .filter((s) => svcs.has(s))
    .map((s) => ({ service: s, band: svcs.get(s)!.band, tier: bandTier(svcs.get(s)!.band) as Exclude<Tier, 'D'> }))
    .sort((a, b) => confScore(a.band) !== confScore(b.band) ? confScore(b.band) - confScore(a.band) : a.service.localeCompare(b.service));
  const tier: Tier = matched[0]?.tier ?? 'D';
  const emergencyClaimed = svcs.has('emergencyCare') || f.emergency_quote !== '' || f.claims_247;
  const emergency: EmergencyBacking = emergencyClaimed ? (f.ambulance || f.icu_equipment ? 'backed' : 'claimed') : 'none';
  const all = allWarnings(f, input.needs);
  const seriousWarnings = all.filter((w) => SERIOUS_WARNINGS.includes(w.id) && (w.id !== 'emergency_not_backed' || input.mode === 'urgent')).length;
  const conditionHits: ConditionHit[] = [];
  if (input.age !== null && input.age < 18 && hasAny(svcs, CHILD_SERVICES)) conditionHits.push('child');
  if (input.conditions.pregnant && hasAny(svcs, CONDITION_SERVICES.pregnant)) conditionHits.push('pregnant_obgyn');
  if (input.conditions.pregnant && svcs.has('nicu')) conditionHits.push('pregnant_nicu');
  if (input.conditions.kidney && hasAny(svcs, CONDITION_SERVICES.kidney)) conditionHits.push('kidney');
  if (input.conditions.stroke && hasAny(svcs, CONDITION_SERVICES.stroke)) conditionHits.push('stroke');
  if (input.conditions.diabetes && hasAny(svcs, CONDITION_SERVICES.diabetes)) conditionHits.push('diabetes');
  const score = scoreBreakdown(f, { mode: input.mode, km, needs: input.needs, conditions: input.conditions, age: input.age, unit: input.unit });
  return { mode: input.mode, facility: f, km, tier, matched, emergency, seriousWarnings, conditionHits, warnings: topWarnings(f, input.needs), score };
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

/**
 * Ranks candidates: the critical-need hard filter runs FIRST (a facility
 * without high/medium evidence for a critical need never appears), then
 * everything else is ordering. Non-critical needs never remove a place.
 */
export function rankFacilities(list: readonly Facility[], input: RankInput): Ranked[] {
  const kept = list.filter((f) => passesCriticalFilter(parseServices(f.services), input.needs));
  return kept.map((f) => scoreFacility(f, input)).sort(compareRanked);
}

/** Places whose evidence is good enough to stop widening the search radius. */
export const isRelevant = (r: Ranked) => r.tier === 'A' || r.tier === 'B';
