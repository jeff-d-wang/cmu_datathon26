import { formatDistance } from './geo';
import { CATH_LAB_LABELS, parseLabelEvidence, parseLabelQuotes, type LabelCode } from './labels';
import type { Conditions, Facility, Mode } from './types';

/**
 * Match score 0-100 with a SCORE RANGE (not a statistical confidence interval).
 *
 *  - lower bound: only evidence the record actually lists counts.
 *  - upper bound: also credits what may exist but is hidden (lists cut at 50 items,
 *    "cardiology" tag only, equipment never listed). Unknown is "possibly present", never absent.
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

export const PROCEDURE_LABELS: readonly LabelCode[] = ['L04', 'L05', 'L06', 'L07', 'L08'];
export const LABEL_NAMES: Record<LabelCode, string> = {
  L01: 'Heart specialist (cardiology)',
  L02: 'Heart tests (ECG, TMT, Holter)',
  L03: 'Heart scan (echo)',
  L04: 'Angiography (cath lab)',
  L05: 'Angioplasty and stents',
  L06: 'Bypass surgery',
  L07: 'Heart and valve surgery',
  L08: 'Heart rhythm care and pacemaker',
  L09: 'Cardiac intensive care',
  L10: 'Heart failure care',
  L11: "Children's heart care",
  L12: 'Cardiac rehabilitation',
};

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
  /** Independent fields/sources behind the strongest match. */
  sources: number;
  components: ScoreComponent[];
  /** One sentence: why this place is in the list. */
  why: string;
}

export interface ScoreInput {
  mode: Mode;
  km: number;
  wantedLabels: readonly LabelCode[];
  conditions: Conditions;
  age: number | null;
  unit?: 'km' | 'mi';
}

type Level = 'A' | 'B' | 'C' | 'D';
const LO: Record<Level, number> = { A: 1, B: 0.8, C: 0.3, D: 0 };

function labelLevel(f: Facility, label: LabelCode, ev: { fields: number; text: boolean } | undefined): Level {
  if (!ev) return 'D';
  if (!ev.text) return 'C';
  const equipment = (CATH_LAB_LABELS.includes(label) && f.cath_equipment) || (label === 'L09' && f.icu_equipment);
  return ev.fields >= 2 || equipment ? 'A' : 'B';
}

/** Upper-bound credit for a label: hidden by the 50-item cap or behind a "cardiology" tag. */
function labelHi(level: Level, truncated: boolean, cardioTag: boolean): number {
  if (level === 'A' || level === 'B') return LO[level];
  if (level === 'C') return 0.8;
  return truncated ? 0.6 : cardioTag ? 0.3 : 0;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function labelEvidence(f: Facility, labels: readonly LabelCode[], levels: Map<LabelCode, Level>, quotes: Map<LabelCode, string>, truncated: boolean): Evidence[] {
  const src = f.website || undefined;
  return labels.map((l) => {
    const lv = levels.get(l) ?? 'D';
    const name = LABEL_NAMES[l];
    if (lv === 'A') return { text: `${name}: listed, backed by another field or equipment`, quote: quotes.get(l), source: src };
    if (lv === 'B') return { text: `${name}: listed in the service text`, quote: quotes.get(l), source: src };
    if (lv === 'C') return { text: `${name}: only a "cardiology" tag, no service described`, unknown: true };
    return truncated
      ? { text: `${name}: not in the record, but its lists were cut at 50 items, so it may exist`, unknown: true }
      : { text: `${name}: not listed` };
  });
}

export function scoreBreakdown(f: Facility, input: ScoreInput): ScoreResult {
  const w = WEIGHTS[input.mode];
  const ev = parseLabelEvidence(f.label_fields);
  const quotes = parseLabelQuotes(f.label_quotes);
  const truncated = f.list_truncated;
  const cardioTag = ev.has('L01') && !ev.get('L01')?.text;
  const wanted: LabelCode[] = input.wantedLabels.length ? [...input.wantedLabels] : ['L01', 'L02', 'L03'];
  const levels = new Map<LabelCode, Level>();
  for (const l of new Set<LabelCode>([...wanted, ...PROCEDURE_LABELS, 'L09'])) levels.set(l, labelLevel(f, l, ev.get(l)));
  const lvl = (l: LabelCode) => levels.get(l) ?? 'D';
  const src = f.website || undefined;
  const comps: ScoreComponent[] = [];
  const add = (id: ComponentId, lo: number, hi: number, evidence: Evidence[]) =>
    comps.push({ id, weight: w[id], lo: w[id] * clamp01(lo), hi: w[id] * clamp01(Math.max(lo, hi)), evidence });

  // Treatment match: does it list the services this patient likely needs?
  add('treatment', mean(wanted.map((l) => LO[lvl(l)])), mean(wanted.map((l) => labelHi(lvl(l), truncated, cardioTag))), labelEvidence(f, wanted, levels, quotes, truncated));

  // Procedures it carries out (the needed ones, or any listed when only a check-up is needed).
  const neededProc = wanted.filter((l) => PROCEDURE_LABELS.includes(l));
  if (neededProc.length) {
    add('procedures', mean(neededProc.map((l) => LO[lvl(l)])), mean(neededProc.map((l) => labelHi(lvl(l), truncated, cardioTag))), labelEvidence(f, neededProc, levels, quotes, truncated));
  } else {
    const listed = PROCEDURE_LABELS.filter((l) => lvl(l) === 'A' || lvl(l) === 'B');
    const lo = Math.max(0, ...PROCEDURE_LABELS.map((l) => LO[lvl(l)]));
    const hi = Math.max(0, ...PROCEDURE_LABELS.map((l) => labelHi(lvl(l), truncated, cardioTag)));
    add('procedures', lo, hi, listed.length ? labelEvidence(f, listed, levels, quotes, truncated) : [{ text: truncated ? 'No heart procedures listed; lists were cut at 50 items, so some may exist' : 'No heart procedures listed', unknown: truncated }]);
  }

  // Right equipment for those treatments.
  const needCath = wanted.some((l) => CATH_LAB_LABELS.includes(l));
  const needIcu = input.mode === 'urgent' || wanted.includes('L09');
  const eqEv: Evidence[] = [];
  const checks: { met: boolean; hi: number }[] = [];
  if (needCath) {
    const claimed = CATH_LAB_LABELS.some((l) => ev.get(l)?.text);
    if (f.cath_equipment) eqEv.push({ text: 'Cath-lab equipment listed', source: src });
    else if (claimed) eqEv.push({ text: 'Lists cath-lab procedures, but no cath-lab equipment is listed', flag: true, unknown: !f.equipment_listed });
    else eqEv.push({ text: f.equipment_listed ? 'No cath-lab equipment listed' : 'Equipment not listed, unknown', unknown: !f.equipment_listed });
    checks.push({ met: f.cath_equipment, hi: f.cath_equipment || !f.equipment_listed ? 1 : 0 });
  }
  if (needIcu) {
    if (f.icu_equipment) eqEv.push({ text: 'Intensive-care equipment listed (ventilator, monitor or defibrillator)', quote: f.icu_quote || undefined, source: src });
    else if (f.icu_claim) eqEv.push({ text: 'Claims an ICU, but no ventilator, monitor or defibrillator is listed', flag: true, unknown: !f.equipment_listed });
    else eqEv.push({ text: f.equipment_listed ? 'No intensive-care equipment listed' : 'Equipment not listed, unknown', unknown: !f.equipment_listed });
    checks.push({ met: f.icu_equipment, hi: f.icu_equipment || !f.equipment_listed ? 1 : 0 });
  }
  if (checks.length) add('equipment', mean(checks.map((c) => (c.met ? 1 : 0))), mean(checks.map((c) => c.hi)), eqEv);
  else add('equipment', 1, 1, [{ text: 'No special equipment needed for this kind of care' }]);

  // Emergency readiness, and whether other details support the claim.
  const backed = f.emergency_claim && (f.ambulance || f.icu_equipment);
  const emEv: Evidence[] = [];
  if (f.emergency_claim) emEv.push({ text: backed ? 'Lists emergency care, supported by ambulance or ICU equipment' : 'Lists emergency care, nothing else in the record supports it', quote: f.emergency_quote || undefined, source: src, flag: !backed });
  else emEv.push({ text: truncated ? 'Emergency care not listed; lists were cut, so it may exist' : 'Emergency care not listed', unknown: truncated });
  if (f.claims_247) emEv.push({ text: 'Says open 24/7 (not verified)' });
  if (f.ambulance) emEv.push({ text: 'Ambulance listed' });
  add('emergency', f.emergency_claim ? (backed ? 1 : 0.6) : 0, f.emergency_claim ? 1 : truncated ? 0.4 : 0, emEv);

  // Reputation: self-reported web signals only, never patient ratings.
  const indep = f.source_class === 'non_directory' || f.source_class === 'gov';
  const repEv: Evidence[] = [];
  if (f.says_nabh) repEv.push({ text: 'Mentions NABH accreditation (self-reported)', quote: f.nabh_quote || undefined, source: src });
  if (indep) repEv.push({ text: f.source_class === 'gov' ? 'Found on a government source' : 'Found on a source other than a directory' });
  if (f.website) repEv.push({ text: 'Has its own website', source: f.website });
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
  const needs: { met: boolean; text: string }[] = [];
  if (input.age !== null && input.age < 18) needs.push({ met: lvl('L11') === 'A' || lvl('L11') === 'B', text: "Children's heart care (patient under 18)" });
  if (input.conditions.pregnant) needs.push({ met: f.has_obgyn || f.has_nicu, text: 'Maternity and newborn care (pregnant)' });
  if (input.conditions.kidney) needs.push({ met: f.has_dialysis, text: 'Dialysis (kidney disease)' });
  if (input.conditions.stroke) needs.push({ met: f.has_neuro_stroke, text: 'Neurology and stroke care (past stroke)' });
  if (input.conditions.diabetes) needs.push({ met: f.has_diabetes_care, text: 'Diabetes care' });
  if (needs.length) {
    add('accommodate', mean(needs.map((n) => (n.met ? 1 : 0))), mean(needs.map((n) => (n.met ? 1 : truncated ? 0.5 : 0))),
      needs.map((n) => ({ text: `${n.text}: ${n.met ? 'listed' : truncated ? 'not listed, may exist (lists were cut)' : 'not listed'}`, unknown: !n.met && truncated, source: n.met ? src : undefined })));
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
  const sources = Math.max(0, ...wanted.map((l) => ev.get(l)?.fields ?? 0)) + (indep ? 1 : 0);
  const width = hi - lo;
  const confidence = confidenceFromRange(width, sources);
  return { score, lo, hi, confidence, sources, components: comps, why: whySentence(f, input, wanted, levels, backed) };
}

function whySentence(f: Facility, input: ScoreInput, wanted: LabelCode[], levels: Map<LabelCode, Level>, backed: boolean): string {
  const listed = wanted.filter((l) => levels.get(l) === 'A' || levels.get(l) === 'B').map((l) => LABEL_NAMES[l].replace(/^[A-Z][a-z]/, (m) => m.toLowerCase()));
  const parts: string[] = [];
  parts.push(listed.length ? `Lists ${listed.slice(0, 2).join(' and ')}` : 'Does not clearly list the care you need');
  if (input.mode === 'urgent') parts.push(f.emergency_claim ? (backed ? 'emergency care with support' : 'emergency care (not backed)') : 'no emergency care listed');
  parts.push(`${formatDistance(input.km, input.unit ?? 'km')} away${f.loc_approx ? ' (approximate)' : ''}`);
  return parts.join(', ') + '.';
}

export function confidenceFromRange(width: number, sources: number): Confidence {
  return width <= 12 && sources >= 2 ? 'High' : width <= 25 && sources >= 1 ? 'Medium' : 'Low';
}
