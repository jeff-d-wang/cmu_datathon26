import { LARGE_PROCEDURE_LABELS, parseLabelFields, parseLabelQuotes } from './labels';
import type { Facility } from './types';

export type WarningId = 'location_approx' | 'icu_no_equipment' | 'tag_only' | 'emergency_not_backed' | 'merged' | 'large_procedure_small_facility';

export interface DataWarning {
  id: WarningId;
  /** Quoted source text or the data reason, shown behind "why". */
  why: string;
}

/** Ranked order from findings Q13 (spec). The UI shows at most 2. */
const ORDER: WarningId[] = ['location_approx', 'icu_no_equipment', 'tag_only', 'emergency_not_backed', 'merged', 'large_procedure_small_facility'];

export function allWarnings(f: Facility): DataWarning[] {
  const out: DataWarning[] = [];
  if (f.loc_approx) out.push({ id: 'location_approx', why: 'The listed coordinates are more than 50 km from the PIN code centre, so we show the PIN code centre instead.' });
  if (f.icu_claim && f.equipment_listed && !f.icu_equipment) out.push({ id: 'icu_no_equipment', why: f.icu_quote ? `“${f.icu_quote.trim()}”, but no ventilator, monitor or defibrillator is in the equipment list.` : 'Intensive care is mentioned, but no ventilator, monitor or defibrillator is listed.' });
  if (!f.has_service_text) out.push({ id: 'tag_only', why: 'The record only has a “cardiology” tag. No heart service is described in the text.' });
  if (f.claims_247 && f.emergency_claim && !f.ambulance && !f.icu_equipment) out.push({ id: 'emergency_not_backed', why: f.emergency_quote ? `“${f.emergency_quote.trim()}”, but no ambulance or ICU equipment is listed.` : 'Says 24/7 emergency, but no ambulance or ICU equipment is listed.' });
  if (f.merge_suspect) out.push({ id: 'merged', why: `${f.merge_signals} signs that this record combines several branches (far from its PIN code, many phone numbers or websites).` });
  const labels = parseLabelFields(f.label_fields);
  const big = LARGE_PROCEDURE_LABELS.find((l) => labels.has(l));
  if (f.small_facility && big) {
    const q = parseLabelQuotes(f.label_quotes).get(big) ?? '';
    out.push({ id: 'large_procedure_small_facility', why: `${q ? `“${q}” ` : ''}is listed by a ${f.facility_type} with ${f.doctors ?? 'an unknown number of'} doctors and ${f.beds ?? 'unknown'} beds.` });
  }
  return out.sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
}

export function topWarnings(f: Facility, max = 2): DataWarning[] {
  return allWarnings(f).slice(0, max);
}
