// Pure TypeScript port of Alvin's facility-finder ("Minimal app pipeline", engine-src/ff.py).
// score = match x relevance x distance x trust. Not a probability. No I/O, no logging: symptom text never leaves the caller.
import complaintsJson from './data/complaints.json';
import pathwaysJson from './data/pathways.json';
import guidelinesJson from './data/guidelines.json';
import type { EngineEntry, EngineResult, NeedTuple, EngineMeta, EngineConfidence } from './contract';

/** A place is relevant to the needed care when its match is at least this. */
export const MIN_MATCH = 0.2;
/** Split ranked results into relevant (match >= min, order kept) and weak (the rest, order kept). */
export function splitRelevant<T extends { match: number }>(results: readonly T[], min: number = MIN_MATCH): { relevant: T[]; weak: T[] } {
  return { relevant: results.filter((r) => r.match >= min), weak: results.filter((r) => r.match < min) };
}

export interface EngineFacility {
  id: string; name: string; city: string; state: string; pin: string; facility_type: string;
  capacity: number | null; lat: number; lon: number;
  centroid_lat: number | null; centroid_lon: number | null; pincode_matched: boolean;
  phone: string; website: string;
  /** Specialty tags and the service-relevant items of each text field (already split). */
  specialties: string[]; procedure: string[]; equipment: string[]; capability: string[]; description: string;
}

interface Complaint { code: number; label: string; n_visits: number; needs: { service: string; share: number; ci_lo: number; ci_hi: number }[]; shares: Record<string, number> }
interface Rule { tags: string[]; focus: string[]; escalation: string }
interface Profile { label: string; kw?: string; services: Record<string, number>; critical: boolean; advice: string }
const COMPLAINTS = complaintsJson as unknown as Complaint[];
const PATHWAYS = pathwaysJson as unknown as Record<string, Rule>;
const GUIDELINE = Object.values((guidelinesJson as unknown as { guidelines: Record<string, Profile> }).guidelines);
const FALLBACK = (guidelinesJson as unknown as { fallback: Profile }).fallback;

// service_id: [match, exclude, weak-evidence specialty tags, group]
type Svc = [RegExp, RegExp | null, string[], 'eval' | 'care'];
const SERVICES: Record<string, Svc> = {
  emergency: [/emergency|casualty|trauma cent/i, /emergency (ent|eye|dental|ophthal)|(dental|eye|ent) emergenc|emergency (contracept|exit|contact|number)/i, ['emergencymedicine'], 'eval'],
  ecg: [/\becg\b|\bekg\b|electrocardiogra/i, null, ['cardiology'], 'eval'],
  xray: [/x-?ray|radiograph/i, /dental x-?ray|opg/i, ['radiology'], 'eval'],
  ct: [/\bct\b|computed tomograph/i, /cone[- ]beam|cbct|dental ct/i, ['radiology'], 'eval'],
  mri: [/\bmri\b|magnetic resonance/i, null, ['radiology'], 'eval'],
  ultrasound: [/ultrasound|sonograph|\busg\b/i, null, ['radiology'], 'eval'],
  lab: [/laborator|patholog|blood test/i, /cath(eteri[sz]ation)? lab|maxillofacial|oral patholog|speech|dental lab|radiology lab|research lab|ivf lab|embryo/i, ['pathology'], 'eval'],
  fracture_care: [/fracture|plaster|\bcasts?\b|splint/i, /dental|tooth|teeth/i, ['orthopedicsurgery'], 'eval'],
  inpatient: [/inpatient|in-patient|\bipd\b|\b\d+[\s-]*bed/i, null, [], 'care'],
  icu: [/\bicu\b|intensive care|critical care/i, null, ['criticalcaremedicine'], 'care'],
  operating_room: [/operation theat|operating (room|theat)/i, null, ['generalsurgery'], 'care'],
  cath_lab: [/cath ?lab|catheteri[sz]ation lab|angioplast/i, null, ['interventionalcardiology'], 'care'],
  c_section: [/c[- ]?section|ca?esarean|\blscs\b/i, null, [], 'care'],
  dialysis: [/dialy/i, null, ['nephrology'], 'care'],
};
export const SERVICE_IDS = Object.keys(SERVICES);
const GLOBAL_EXCLUDE = /not available|referred (out|to)|refers? patients to|referral hospital|outside the state/i;
const TEXT_FIELDS = ['procedure', 'equipment', 'capability', 'description'] as const;
const EVIDENCE_VALUE = { documented_multi: 1.0, documented_single: 0.7, structured_field: 0.5, tag_only: 0.3 } as const;
const W_EVAL = 0.7, W_CARE = 0.3, W_ESCALATION = 0.5;
const TAU_URGENT_KM = 15, TAU_ROUTINE_KM = 40, MAX_KM = 300;
const FOCUS: Record<string, RegExp> = {
  eye: /\beye\b|ophthal|netr|nethr/i, ent: /\bent\b|ear nose/i, dental: /dental|dentist|tooth|orthodon/i,
  urology: /urolog|kidney|nephro/i, skin: /\bskin\b|derma|cosmet|\bhair\b/i, child: /child|paediatric|pediatric|\bkids\b/i,
  ortho: /ortho|\bbone\b|spine|joint|fracture/i, heart: /heart|cardiac|cardio/i, chest: /chest|lung|pulmo/i,
  maternity: /maternity|women|gyna?ec|fertility|\bivf\b|nursing home/i, neuro: /neuro|brain/i,
  cancer: /cancer|onco/i, physio: /physio|rehab/i, alt: /ayur|homeo|unani|naturopath/i,
  diagnostic: /diagnostic|imaging|scan cent|patholog/i, mental: /psychiat|mental|de-?addiction/i,
};
const GENERAL = /multi[- ]?s|general hospital|medical college|super[- ]?spe|district hospital|civil hospital/i;
const REL_FIT = 1.0, REL_NO_TAG = 0.5, REL_CONFLICT = 0.3;

export const kmBetween = (a: number, b: number, c: number, d: number): number => {
  const [p, q, r, s] = [a, b, c, d].map((x) => (x * Math.PI) / 180);
  const x = Math.sin((r - p) / 2) ** 2 + Math.cos(p) * Math.cos(r) * Math.sin((s - q) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(x));
};
export const distanceFactor = (km: number, tau: number): number => 1 / (1 + (km / tau) ** 2);
export const tierOf = (m: number): EngineConfidence => (m >= 0.65 ? 'HIGH' : m >= 0.4 ? 'MEDIUM' : 'LOW');

// ---- Evidence ----
export type EvidenceStatus = keyof typeof EVIDENCE_VALUE;
export interface Evidence { value: Record<string, number>; quote: Record<string, string>; status: Record<string, EvidenceStatus> }
const ok = (s: string, item: string) => SERVICES[s][0].test(item) && !GLOBAL_EXCLUDE.test(item) && !(SERVICES[s][1]?.test(item) ?? false);

export function buildEvidence(f: EngineFacility): Evidence {
  const items: Record<string, string[]> = { procedure: f.procedure, equipment: f.equipment, capability: f.capability, description: f.description.trim() ? [f.description] : [] };
  const tags = new Set(f.specialties.map((t) => t.toLowerCase().replace(/\s+/g, '')));
  const ev: Evidence = { value: {}, quote: {}, status: {} };
  for (const [s, [, , stags]] of Object.entries(SERVICES)) {
    const hits: string[] = [];
    for (const fld of TEXT_FIELDS) {
      const q = items[fld].find((i) => ok(s, i));
      if (q !== undefined) hits.push(q);
    }
    let status: EvidenceStatus; let quote: string;
    if (hits.length >= 2) { status = 'documented_multi'; quote = hits[0]; }
    else if (hits.length === 1) { status = 'documented_single'; quote = hits[0]; }
    else if (s === 'inpatient' && (f.facility_type === 'hospital' || (f.capacity ?? 0) > 0)) { status = 'structured_field'; quote = `type=${f.facility_type} capacity=${f.capacity ?? ''}`; }
    else if (stags.some((t) => tags.has(t))) { status = 'tag_only'; quote = stags.find((t) => tags.has(t)) as string; }
    else continue;
    ev.value[s] = EVIDENCE_VALUE[status]; ev.status[s] = status; ev.quote[s] = quote.slice(0, 100);
  }
  return ev;
}

// ---- Trust: coordinates vs the PIN centroid. (The notebook's stated-city vs district-centroid check needs a directory the clean rows lack: not ported.) ----
export function trustOf(f: EngineFacility): { trust: number; flags: string[] } {
  let trust = 1.0; const flags: string[] = [];
  const gap = f.pincode_matched && f.centroid_lat !== null && f.centroid_lon !== null ? kmBetween(f.lat, f.lon, f.centroid_lat, f.centroid_lon) : null;
  if (gap === null) { trust *= 0.85; flags.push('PIN not in directory'); }
  else if (gap > 100) { trust *= 0.6; flags.push(`coordinates ${gap.toFixed(0)} km from PIN`); }
  else if (gap > 25) { trust *= 0.85; flags.push(`coordinates ${gap.toFixed(0)} km from PIN`); }
  return { trust, flags };
}

// ---- Match / relevance ----
const coverage = (shares: Record<string, number>, ev: Record<string, number>, group: string) => {
  const ss = SERVICE_IDS.filter((s) => SERVICES[s][3] === group);
  const tot = ss.reduce((a, s) => a + (shares[s] ?? 0), 0);
  return tot ? ss.reduce((a, s) => a + (shares[s] ?? 0) * (ev[s] ?? 0), 0) / tot : 0;
};
export function matchOf(shares: Record<string, number>, ev: Record<string, number>, rule: Rule | null) {
  const ce = coverage(shares, ev, 'eval'); let cc = coverage(shares, ev, 'care');
  if (rule) cc = W_ESCALATION * (ev[rule.escalation] ?? 0) + (1 - W_ESCALATION) * cc;
  return { match: W_EVAL * ce + W_CARE * cc, ce, cc };
}
function relevanceOf(f: EngineFacility, tags: Set<string>, rule: Rule | null): [number, string] {
  if (!rule) return [1.0, 'no pathway rule for this complaint'];
  const focus = Object.keys(FOCUS).filter((k) => FOCUS[k].test(f.name));
  if (focus.length && !GENERAL.test(f.name) && !focus.some((x) => rule.focus.includes(x))) return [REL_CONFLICT, `name suggests a different focus (${focus.sort().join(', ')})`];
  if (rule.tags.some((t) => tags.has(t))) return [REL_FIT, 'specialty tag fits'];
  return [REL_NO_TAG, 'no fitting specialty tag'];
}

// ---- Complaint matcher ----
const STOP = new Set(['i', 'my', 'me', 'have', 'has', 'a', 'an', 'the', 'and', 'or', 'in', 'of', 'to', 'is', 'was', 'for', 'with', 'on', 'at', 'very', 'really', 'bad', 'severe', 'high', 'this', 'it', 'his', 'her', 'trouble', 'difficulty', 'cant', 'be', 'might', 'may', 'should', 'think']);
const SYN: Record<string, string> = {
  ache: 'pain', aches: 'pain', hurts: 'pain', hurt: 'pain', hurting: 'pain', tummy: 'stomach', belly: 'stomach', abdominal: 'stomach',
  breathe: 'breath', breathing: 'breath', vomiting: 'vomit', puking: 'vomit', migraine: 'headache', dizzy: 'dizziness', temperature: 'fever',
  broken: 'fracture', fractured: 'fracture', cut: 'lacerations', cuts: 'lacerations', arm: 'extremity', arms: 'extremity', leg: 'extremity', legs: 'extremity',
};
export function tokens(text: string): Set<string> {
  const out = new Set<string>();
  for (let t of String(text).toLowerCase().match(/[a-z']+/g) ?? []) {
    if (STOP.has(t)) continue;
    if (t.length > 3) t = t.replace(/s+$/, '');
    t = SYN[t] ?? t;
    if (!STOP.has(t)) out.add(t);
  }
  return out;
}
const COMPLAINT_TOKENS = new Map(COMPLAINTS.map((c) => [c.code, tokens(c.label)]));
const BY_CODE = new Map(COMPLAINTS.map((c) => [c.code, c]));

/** English symptom text -> best-matching complaint codes as [score, n_visits, code]. */
export function findComplaint(text: string, top = 3): [number, number, number][] {
  const q = tokens(text);
  const hits: [number, number, number][] = [];
  for (const [code, lt] of COMPLAINT_TOKENS) {
    const inter = [...q].filter((t) => lt.has(t)).length;
    if (inter) hits.push([inter / Math.max(q.size, 1), (BY_CODE.get(code) as Complaint).n_visits, code]);
  }
  hits.sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  return hits.slice(0, top);
}

/** Our symptom chip ids -> the notebook's query text. Own-words text is passed to the matcher as typed. */
const CHIP_QUERY: Record<string, string> = {
  stroke_signs: 'stroke symptoms, face drooping', kidney: 'need dialysis for kidney failure', chest_pressure: 'chest pain',
  breathless: 'shortness of breath', fainting: 'fainting', racing_heartbeat: 'palpitations', swollen_legs: 'swelling of legs',
  unusual_tiredness: 'fatigue', dizziness: 'dizziness', cough: 'cough', high_bp: 'high blood pressure', leg_pain_walking: 'leg pain', valve_murmur: 'heart murmur',
};
/** Highest-priority mapped chip wins (stroke and kidney first); otherwise the own words, as typed. */
export const chipsToQuery = (ids: readonly string[], ownWords: string): string => {
  const chip = Object.keys(CHIP_QUERY).find((k) => ids.includes(k));
  return chip ? CHIP_QUERY[chip] : ownWords.trim();
};

// ---- find_facilities ----
const round = (x: number, n: number) => Math.round(x * 10 ** n) / 10 ** n;
export interface EngineRun { label: string; needs: NeedTuple[]; results: EngineResult[]; meta: EngineMeta; tolerance_km: number; alternates: string[]; escalation?: string; source: string }

export function run(query: string | number, lat: number, lon: number, facilities: readonly EngineFacility[], topK = 15): EngineRun {
  const q = String(query).trim();
  let code: number | null = null; let pathway: Profile | null = null; let alternates: string[] = [];
  if (/^\d+$/.test(q)) {
    code = Number(q);
    if (!BY_CODE.has(code)) throw new Error(`complaint code ${code} is not offered`);
  } else {
    const matches = findComplaint(q);
    const g = GUIDELINE.find((v) => new RegExp(v.kw as string).test(q.toLowerCase()));
    if (g && (!matches.length || matches[0][0] < 0.5)) pathway = g;
    else if (matches.length) { code = matches[0][2]; alternates = matches.slice(1).map((m) => (BY_CODE.get(m[2]) as Complaint).label); }
    else pathway = FALLBACK;
  }
  let shares: Record<string, number>; let rule: Rule | null; let critical: boolean; let label: string; let source: string; let routeWhy: string; let needs: NeedTuple[];
  if (code !== null) {
    const nc = BY_CODE.get(code) as Complaint;
    shares = nc.shares; rule = PATHWAYS[String(code)] ?? null; critical = shares.emergency >= 0.6;
    label = nc.label; source = 'NHAMCS 2022 survey-weighted shares';
    needs = nc.needs.map((n) => [n.service, n.share, n.ci_lo, n.ci_hi]);
    routeWhy = 'complaint mapped to emergency-visit survey frequencies (data-backed)';
  } else {
    const p = pathway as Profile;
    shares = Object.fromEntries(SERVICE_IDS.map((s) => [s, p.services[s] ?? 0])); rule = null; critical = p.critical; label = p.label;
    source = p === FALLBACK ? 'generic fallback' : 'expert guideline (no survey frequency data)';
    needs = Object.entries(p.services).sort((a, b) => b[1] - a[1]).map(([s, v]) => [s, v, null, null]);
    routeWhy = source + (p !== FALLBACK ? ' - service shares are expert-set guideline values, not survey data (no CI)' : ' - description not recognised; nearest general care, generic shares');
  }
  const tau = critical ? TAU_URGENT_KM : TAU_ROUTINE_KM;
  const scored = facilities.flatMap((f) => {
    if (!Number.isFinite(f.lat) || !Number.isFinite(f.lon)) return [];
    const d = kmBetween(lat, lon, f.lat, f.lon);
    if (d > MAX_KM) return [];
    const ev = buildEvidence(f);
    const { match } = matchOf(shares, ev.value, rule);
    const [rel, why] = code !== null ? relevanceOf(f, new Set(f.specialties.map((t) => t.toLowerCase().replace(/\s+/g, ''))), rule) : [1.0, 'guideline pathway'] as [number, string];
    const { trust, flags } = trustOf(f);
    return [{ f, d, ev, match, rel, why, trust, flags, score: match * rel * distanceFactor(d, tau) * trust }];
  });
  scored.sort((a, b) => b.score - a.score);
  const results: EngineResult[] = scored.slice(0, topK).map((t, i) => {
    const weak = needs.slice(0, 3).filter(([s]) => t.ev.value[s] === 0.3).map(([s]) => s);
    const conf = tierOf(t.match);
    return {
      rank: i + 1, facility_id: t.f.id, name: t.f.name, city: t.f.city, type: t.f.facility_type, km: round(t.d, 1), score: round(t.score, 3),
      match: round(t.match, 2), relevance: t.rel, relevance_reason: t.why, trust: round(t.trust, 2), location_flags: t.flags, confidence: conf,
      confidence_reasons: [routeWhy, ...(weak.length ? [`tag-only evidence for ${weak.join(', ')}`] : []), ...t.flags],
      evidence: t.ev.quote, evidence_status: t.ev.status, state: t.f.state, pin: t.f.pin, capacity: t.f.capacity, lat: t.f.lat, lon: t.f.lon, phone: t.f.phone, website: t.f.website,
    };
  });
  let advisory = pathway ? pathway.advice : critical ? 'If this is sudden or severe, call 112 (or 108 for an ambulance) before travelling.' : '';
  if (critical && results.length && results.every((r) => r.confidence === 'LOW')) advisory = `EMERGENCY FIRST - ${advisory} Facility matches below are LOW confidence: a starting point, not a decision.`;
  return { label, needs, results, meta: { advisory, critical, source }, tolerance_km: tau, alternates, escalation: rule?.escalation, source };
}

/** The notebook's contract: {label, needs, results, meta}. */
export function findFacilities(query: string | number, lat: number, lon: number, facilities: readonly EngineFacility[], topK = 15) {
  const { label, needs, results, meta } = run(query, lat, lon, facilities, topK);
  return { label, needs, results, meta };
}

/** Same call, shaped for the existing EngineResults screen. */
export function findEntry(query: string | number, pin: string, lat: number, lon: number, facilities: readonly EngineFacility[], topK = Infinity): EngineEntry {
  const r = run(query, lat, lon, facilities, topK);
  return { query: String(query), pin, label: r.label, source: r.source, tolerance_km: r.tolerance_km, escalation: r.escalation, alternates: r.alternates, needs: r.needs, meta: r.meta, results: r.results };
}
