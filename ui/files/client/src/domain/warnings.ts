import { parseServices, serviceName, type Need, type ServiceEvidence } from './services';
import type { Facility } from './types';

export type WarningId = 'location_approx' | 'icu_no_equipment' | 'unverified_need' | 'emergency_not_backed' | 'scale_mismatch' | 'merged';

export interface DataWarning {
  id: WarningId;
  /** Quoted source text or the data reason, shown behind "why". */
  why: string;
}

/** Ranked order from findings Q13 (spec). The UI shows at most 2. */
const ORDER: WarningId[] = ['location_approx', 'icu_no_equipment', 'unverified_need', 'emergency_not_backed', 'scale_mismatch', 'merged'];

/**
 * Data-quality warnings for a facility, platinum-backed. `needs` (when the
 * caller has them) adds the unverified-need warning for services the patient
 * asked for whose only evidence is a single unverified mention.
 */
export function allWarnings(f: Facility, needs?: readonly Need[]): DataWarning[] {
  const out: DataWarning[] = [];
  if (f.loc_approx) out.push({ id: 'location_approx', why: 'The listed coordinates are more than 50 km from the PIN code centre, so we show the PIN code centre instead.' });
  if (f.icu_quote && f.equipment_listed && !f.icu_equipment) out.push({ id: 'icu_no_equipment', why: `“${f.icu_quote.trim()}”, but no ventilator, monitor or defibrillator is in the equipment list.` });
  const svcs = parseServices(f.services);
  if (needs) {
    const unverified = needs.map((n) => n.service).find((s) => svcs.get(s)?.band === 'unverified');
    if (unverified !== undefined) out.push({ id: 'unverified_need', why: `${serviceName(unverified)}: a single mention that we could not corroborate with a second source.` });
  }
  const emergencyClaimed = f.emergency_quote !== '' || f.claims_247;
  if (emergencyClaimed && !f.ambulance && !f.icu_equipment) out.push({ id: 'emergency_not_backed', why: f.emergency_quote ? `“${f.emergency_quote.trim()}”, but no ambulance or ICU equipment is listed.` : 'Says 24/7 emergency, but no ambulance or ICU equipment is listed.' });
  const lowBand = lowBandEntry(svcs);
  if (lowBand) out.push({ id: 'scale_mismatch', why: `Lists ${serviceName(lowBand[0])}, but the facility's size makes this doubtful (marked low confidence).` });
  if (f.merge_suspect) out.push({ id: 'merged', why: `${f.merge_signals} signs that this record combines several branches (far from its PIN code, many phone numbers or websites).` });
  return out.sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
}

function lowBandEntry(svcs: Map<string, ServiceEvidence>): [string, ServiceEvidence] | null {
  for (const e of svcs.entries()) if (e[1].band === 'low') return e;
  return null;
}

export function topWarnings(f: Facility, needs?: readonly Need[], max = 2): DataWarning[] {
  return allWarnings(f, needs).slice(0, max);
}
