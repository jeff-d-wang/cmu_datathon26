import { formatDistance } from './geo';
import { confScore, CONDITION_SERVICES, CHILD_SERVICES, parseServices, registryEntry, serviceName, type Need, type ServiceEvidence, type ServiceKey } from './services';
import type { Conditions, Facility, Mode } from './types';

/**
 * Match score 0-100 with a SCORE RANGE (not a statistical confidence interval).
 *
 *  - lower bound: only the platinum evidence the record actually has counts
 *    (per-service confidence bands: high 1.0 / medium 0.5 / unverified 0.3 / low 0.05).
 *  - upper bound: also credits what may exist but is hidden (lists cut at 50 items,
 *    equipment never listed). Unknown is "possibly present", never absent.
 *  - score: lower + 40% of the gap, so lower <= score <= upper always.
 *
 * Pure function, no I/O. Every component returns its weight, its lower/upper fraction and the
 * evidence (quote + source) behind it, or an explicit "unknown" note. The UI renders these as-is.
 * Weights shift with urgency: urgent puts emergency readiness and distance first, planned puts
 * procedure evidence first. No percentages, no patient outcomes: the data has none.
 */
export type ComponentId = 'treatment' | 'procedures' | 'equipment' | 'emergency' | 'reputation' | 'distance' | 'accommodate' | 'quality';
export type Confidence = 'High' | 'Medium' | 'Low';

export const COMPONENT_ORDER: readonly ComponentId[] = ['treatment', 'procedures', 'equipment', 'emergency', 'reputation', 'distance', 'accommodate', 'quality'];

/** Points out of 100 for each component. Each column sums to 100. */
export const WEIGHTS: Record<Mode, Record<ComponentId, number>> = {
  urgent: { emergency: 25, distance: 20, treatment: 20, equipment: 10, procedures: 10, accommodate: 5, reputation: 5, quality: 5 },
  planned: { procedures: 25, treatment: 20, equipment: 15, reputation: 10, accommodate: 10, distance: 10, emergency: 5, quality: 5 },
};

/** How much of the gap between lower and upper the point score takes. */
export const SCORE_POSITION = 0.4;
/** Distance at which the distance component is worth half (km). */
export const DISTANCE_HALF_KM: Record<Mode, number> = { urgent: 25, planned: 60 };
/** Extra uncertainty (km) when a place's location is only the PIN-code centre. */
export const APPROX_LOCATION_KM = 10;

/** Default needs when nothing was extracted: a general checkup with emergency backup. */
const DEFAULT_NEED_KEYS: readonly ServiceKey[] = ['healthCheckupPackages', 'emergencyCare'];

export interface Evidence {
  /** Plain-words statement. */
  text: string;
  /** Text quoted from the record, when there is one. */
  quote?: string;
  /** Where the quote comes from (the place's own website, when listed). */
  source?: string;
  /** This item is not known from the data (counted only in the upper bound). */
  unknown?: boolean;
  /** A data-quality concern about this item. */
  flag?: boolean;
}

export interface ScoreComponent {
  id: ComponentId;
  weight: number;
  /** Points under the lower and upper bound (0..weight). */
  lo: number;
  hi: number;
  evidence: Evidence[];
}

export interface ScoreResult {
  score: number;
  lo: number;
  hi: number;
  confidence: Confidence;
  /** Independent source channels behind the strongest match. */
  sources: number;
  components: ScoreComponent[];
  /** One sentence: why this place is in the list. */
  why: string;
}

export interface ScoreInput {
  mode: Mode;
  km: number;
  /** Weighted need vector over the 192-service catalog (LLM extraction or symptom map). */
  needs: readonly Need[];
  conditions: Conditions;
  age: number | null;
  unit?: 'km' | 'mi';
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Upper-bound credit for a band: unverified may hide a second source; absent may hide behind the 50-item cap. */
function bandHi(band: ServiceEvidence['band'] | undefined, truncated: boolean): number {
  if (band === undefined) return truncated ? 0.5 : 0;
  return band === 'unverified' ? 0.6 : confScore(band);
}

function needEvidence(f: Facility, keys: readonly ServiceKey[], svcs: Map<ServiceKey, ServiceEvidence>): Evidence[] {
  const src = 'facility record';
  const truncated = f.list_truncated;
  return keys.map((k) => {
    const ev = svcs.get(k);
    const name = serviceName(k);
    if (ev?.band === 'high') return { text: `${name}: well evidenced (${ev.channels} source${ev.channels === 1 ? '' : 's'})`, source: src };
    if (ev?.band === 'medium') return { text: `${name}: listed, with some supporting evidence`, source: src };
    if (ev?.band === 'unverified') return { text: `${name}: a single mention we could not corroborate`, source: src, flag: true };
    if (ev?.band === 'low') return { text: `${name}: listed, but contradicted by the facility's size`, source: src, flag: true };
    return truncated
      ? { text: `${name}: not in the record, but its lists were cut at 50 items, so it may exist`, unknown: true }
      : { text: `${name}: not listed` };
  });
}

export function scoreBreakdown(f: Facility, input: ScoreInput): ScoreResult {
  const w = WEIGHTS[input.mode];
  const svcs = parseServices(f.services);
  const truncated = f.list_truncated;
  const needs: Need[] = input.needs.length
    ? [...input.needs]
    : DEFAULT_NEED_KEYS.map((k) => ({ service: k, weight: 1, critical: false }));
  const wSum = needs.reduce((s, n) => s + Math.max(0.001, n.weight), 0);
  const needKeys = needs.map((n) => n.service);
  const src = 'facility record';
  const comps: ScoreComponent[] = [];
  const add = (id: ComponentId, lo: number, hi: number, evidence: Evidence[]) =>
    comps.push({ id, weight: w[id], lo: w[id] * clamp01(lo), hi: w[id] * clamp01(Math.max(lo, hi)), evidence });

  // Treatment match: confidence bands for the services this patient needs, weighted by need importance.
  const treatLo = needs.reduce((s, n) => s + n.weight * confScore(svcs.get(n.service)?.band), 0) / wSum;
  const treatHi = needs.reduce((s, n) => s + n.weight * bandHi(svcs.get(n.service)?.band, truncated), 0) / wSum;
  add('treatment', treatLo, treatHi, needEvidence(f, needKeys, svcs));

  // Procedures it carries out (the needed ones, or any listed procedure when only a check-up is needed).
  const procedureNeeds = needs.filter((n) => registryEntry(n.service)?.type === 'procedure').map((n) => n.service);
  const listedProcedures = [...svcs.entries()].filter(([k]) => registryEntry(k)?.type === 'procedure');
  if (procedureNeeds.length) {
    const lo = mean(procedureNeeds.map((k) => confScore(svcs.get(k)?.band)));
    const hi = mean(procedureNeeds.map((k) => bandHi(svcs.get(k)?.band, truncated)));
    add('procedures', lo, hi, needEvidence(f, procedureNeeds, svcs));
  } else {
    const best = Math.max(0, ...listedProcedures.map(([, ev]) => confScore(ev.band)));
    add('procedures', best, best, listedProcedures.length
      ? needEvidence(f, listedProcedures.map(([k]) => k), svcs)
      : [{ text: truncated ? 'No procedures listed; lists were cut at 50 items, so some may exist' : 'No procedures listed', unknown: truncated }]);
  }

  // Right equipment for those treatments.
  const needIcu = input.mode === 'urgent' || needKeys.includes('icu') || needKeys.includes('emergencyCare');
  const eqEv: Evidence[] = [];
  const checks: { met: boolean; hi: number }[] = [];
  if (needIcu) {
    if (f.icu_equipment) eqEv.push({ text: 'Intensive-care equipment listed (ventilator, monitor or defibrillator)', quote: f.icu_quote || undefined, source: src });
    else if (f.icu_quote) eqEv.push({ text: 'Mentions intensive care, but no ventilator, monitor or defibrillator is listed', quote: f.icu_quote, source: src, flag: true, unknown: !f.equipment_listed });
    else eqEv.push({ text: f.equipment_listed ? 'No intensive-care equipment listed' : 'Equipment not listed, unknown', unknown: !f.equipment_listed });
    checks.push({ met: f.icu_equipment, hi: f.icu_equipment || !f.equipment_listed ? 1 : 0 });
  }
  if (checks.length) add('equipment', mean(checks.map((c) => (c.met ? 1 : 0))), mean(checks.map((c) => c.hi)), eqEv);
  else add('equipment', 1, 1, [{ text: 'No special equipment needed for this kind of care' }]);

  // Emergency readiness, and whether other details support the claim.
  const claimed = svcs.has('emergencyCare') || f.emergency_quote !== '' || f.claims_247;
  const backed = claimed && (f.ambulance || f.icu_equipment);
  const emEv: Evidence[] = [];
  const emBand = svcs.get('emergencyCare')?.band;
  if (claimed) emEv.push({ text: backed ? 'Lists emergency care, supported by ambulance or ICU equipment' : 'Lists emergency care, nothing else in the record supports it', quote: f.emergency_quote || undefined, source: src, flag: !backed });
  else emEv.push({ text: truncated ? 'Emergency care not listed; lists were cut, so it may exist' : 'Emergency care not listed', unknown: truncated });
  if (emBand) emEv.push({ text: `Emergency care evidence: ${emBand} confidence` });
  if (f.claims_247) emEv.push({ text: 'Says open 24/7 (not verified)' });
  if (f.ambulance) emEv.push({ text: 'Ambulance listed' });
  add('emergency', claimed ? (backed ? 1 : 0.6) : 0, claimed ? 1 : truncated ? 0.4 : 0, emEv);

  // Reputation: self-reported web signals only, never patient ratings.
  const indep = f.source_class === 'non_directory' || f.source_class === 'gov';
  const repEv: Evidence[] = [];
  if (f.says_nabh) repEv.push({ text: 'Mentions NABH accreditation (self-reported)', quote: f.nabh_quote || undefined, source: src });
  if (indep) repEv.push({ text: f.source_class === 'gov' ? 'Found on a government source' : 'Found on a source other than a directory' });
  if (f.website) repEv.push({ text: 'Has its own website', source: f.website.replace(/^https?:\/\//i, '').replace(/\/$/, '') });
  if (!repEv.length) repEv.push({ text: 'No accreditation or independent source found in the data' });
  const rep = (f.says_nabh ? 0.5 : 0) + (indep ? 0.3 : 0) + (f.website ? 0.2 : 0);
  add('reputation', rep, rep, repEv);

  // Distance (straight line). An approximate location widens the range.
  const half = DISTANCE_HALF_KM[input.mode];
  const dist = (km: number) => 1 / (1 + (Math.max(0, km) / half) ** 2);
  const approx = f.loc_approx;
  add('distance', dist(input.km + (approx ? APPROX_LOCATION_KM : 0)), dist(input.km - (approx ? APPROX_LOCATION_KM : 0)), [
    { text: `${formatDistance(input.km, input.unit ?? 'km').replace(/^u/, 'U')} in a straight line (road distance is longer)` },
    ...(approx ? [{ text: 'Approximate location: only the PIN-code centre is known', flag: true, unknown: true }] : []),
  ]);

  // Can they accommodate this patient? Boosts only; never hides a place.
  const condMet = (keys: readonly ServiceKey[]) => keys.some((k) => svcs.has(k));
  const conds: { met: boolean; text: string }[] = [];
  if (input.age !== null && input.age < 18) conds.push({ met: condMet(CHILD_SERVICES), text: "Children's care (patient under 18)" });
  if (input.conditions.pregnant) conds.push({ met: condMet(CONDITION_SERVICES.pregnant), text: 'Maternity and newborn care (pregnant)' });
  if (input.conditions.kidney) conds.push({ met: condMet(CONDITION_SERVICES.kidney), text: 'Dialysis (kidney disease)' });
  if (input.conditions.stroke) conds.push({ met: condMet(CONDITION_SERVICES.stroke), text: 'Neurology care (past stroke)' });
  if (input.conditions.diabetes) conds.push({ met: condMet(CONDITION_SERVICES.diabetes), text: 'Diabetes care' });
  if (conds.length) {
    add('accommodate', mean(conds.map((c) => (c.met ? 1 : 0))), mean(conds.map((c) => (c.met ? 1 : truncated ? 0.5 : 0))),
      conds.map((c) => ({ text: `${c.text}: ${c.met ? 'listed' : truncated ? 'not listed, may exist (lists were cut)' : 'not listed'}`, unknown: !c.met && truncated, source: c.met ? src : undefined })));
  } else add('accommodate', 1, 1, [{ text: 'Nothing extra entered about the patient' }]);

  // Data quality.
  const qEv: Evidence[] = [];
  let q = 1;
  if (truncated) { q -= 0.2; qEv.push({ text: 'Some lists were cut at 50 items', flag: true }); }
  if (approx) { q -= 0.3; qEv.push({ text: 'Approximate location', flag: true }); }
  if (f.merge_suspect) { q -= 0.4; qEv.push({ text: 'The record may mix several branches', flag: true }); }
  if (!qEv.length) qEv.push({ text: 'No data-quality concerns found' });
  add('quality', q, q, qEv);

  comps.sort((a, b) => b.weight - a.weight || COMPONENT_ORDER.indexOf(a.id) - COMPONENT_ORDER.indexOf(b.id));
  const loSum = comps.reduce((s, c) => s + c.lo, 0);
  const hiSum = comps.reduce((s, c) => s + c.hi, 0);
  const lo = Math.floor(loSum + 1e-9);
  const hi = Math.ceil(hiSum - 1e-9);
  const score = Math.min(hi, Math.max(lo, Math.round(loSum + SCORE_POSITION * (hiSum - loSum))));
  const sources = Math.max(0, ...needKeys.map((k) => svcs.get(k)?.channels ?? 0)) + (indep ? 1 : 0);
  const width = hi - lo;
  const confidence = confidenceFromRange(width, sources);
  return { score, lo, hi, confidence, sources, components: comps, why: whySentence(f, input, needKeys, svcs, backed) };
}

function whySentence(f: Facility, input: ScoreInput, needKeys: ServiceKey[], svcs: Map<ServiceKey, ServiceEvidence>, backed: boolean): string {
  const listed = needKeys
    .filter((k) => { const b = svcs.get(k)?.band; return b === 'high' || b === 'medium'; })
    .map((k) => serviceName(k).replace(/^[A-Z][a-z]/, (m) => m.toLowerCase()));
  const parts: string[] = [];
  parts.push(listed.length ? `Lists ${listed.slice(0, 2).join(' and ')}` : 'Does not clearly list the care you need');
  if (input.mode === 'urgent') parts.push(svcs.has('emergencyCare') ? (backed ? 'emergency care with support' : 'emergency care (not backed)') : 'no emergency care listed');
  parts.push(`${formatDistance(input.km, input.unit ?? 'km')} away${f.loc_approx ? ' (approximate)' : ''}`);
  return parts.join(', ') + '.';
}

export function confidenceFromRange(width: number, sources: number): Confidence {
  return width <= 12 && sources >= 2 ? 'High' : width <= 25 && sources >= 1 ? 'Medium' : 'Low';
}
