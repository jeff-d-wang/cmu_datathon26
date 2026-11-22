/**
 * Citations: find the sentences in a facility's own record that back a service claim, so every important claim can
 * quote the underlying facility text (challenge rule). Pure functions; the record comes from config/queries/facility_record.sql.
 */

export interface FacilityRecord {
  description: string;
  specialties: string;
  procedures: string;
  equipment: string;
  capability: string;
  source_urls: string;
  /** "service:channel,channel|service:channel" from platinum.facility_service_evidence. */
  channels: string;
}

export type RecordField = 'description' | 'procedures' | 'capability' | 'equipment' | 'specialties';

export interface Quote {
  text: string;
  field: RecordField;
}

/** Plain-language name of each record field (what the user sees as the citation). */
export const FIELD_LABEL: Record<RecordField, string> = {
  description: 'description',
  procedures: 'procedures list',
  capability: 'capabilities list',
  equipment: 'equipment list',
  specialties: 'specialty list',
};

/** Words that say nothing about a specific service, never used for matching. */
const STOP = new Set(['and', 'the', 'care', 'with', 'service', 'services', 'unit', 'treatment', 'medicine', 'surgery', 'procedures', 'clinical', 'general', 'imaging', 'machine', 'scanner']);

/** Extra words the records use for some services (the catalog name alone would miss them). */
const EXTRA: Record<string, string[]> = {
  gynecologyAndObstetrics: ['obstetric', 'gynaec', 'gynae', 'gynec', 'maternity', 'delivery', 'caesarean', 'cesarean', 'c-section', 'lscs', 'hysterectomy'],
  mriScanner: ['mri', 'magnetic resonance'],
  ctScanner: ['ct scan', 'ct scanner', 'computed tomography'],
  dialysis: ['dialysis', 'haemodialysis', 'hemodialysis'],
  nicu: ['nicu', 'neonatal intensive', 'newborn intensive'],
  icu: ['icu', 'intensive care', 'critical care'],
  emergencyCare: ['emergency', 'casualty', 'trauma', '24x7', '24/7'],
  cardiacSurgery: ['cardiac surg', 'heart surg', 'valve', 'cardiothoracic', 'cabg', 'bypass'],
  cabgSurgery: ['cabg', 'bypass'],
  cardiology: ['cardiolog', 'cardiac', 'heart'],
  plasticSurgery: ['plastic', 'burn', 'reconstructive'],
  operationTheatre: ['operation theatre', 'operating theatre', 'operation theater', 'ot '],
  bloodBank: ['blood bank', 'blood storage'],
  anesthesia: ['anaesthe', 'anesthe'],
  ambulanceService: ['ambulance'],
  orthopedicSurgery: ['orthop', 'fracture', 'joint replacement'],
  neurosurgery: ['neurosurg', 'brain surg', 'spine surg'],
  ultrasoundImaging: ['ultrasound', 'sonograph', 'usg'],
  xrayImaging: ['x-ray', 'xray', 'radiograph'],
};

/** Words to look for in the record for a catalog service (from its key, its name and EXTRA). Lowercase. */
export function serviceTerms(key: string, name: string): string[] {
  const fromKey = key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/\s+/);
  const fromName = name.toLowerCase().replace(/[()]/g, ' ').split(/[\s/,-]+/);
  const words = [...fromKey, ...fromName].filter((w) => w.length >= 4 && !STOP.has(w))
    // Match word stems so "obstetrics" also finds "obstetric" (drop up to 2 trailing letters, keep at least 5).
    .map((w) => (w.length > 6 ? w.slice(0, w.length - 2) : w));
  return [...new Set([...words, ...(EXTRA[key] ?? [])])];
}

/** Parses a JSON-array text field ("[\"a\",\"b\"]") into its non-empty strings; a plain string becomes sentences. */
export function items(raw: string): string[] {
  const t = raw.trim();
  if (!t) return [];
  if (t.startsWith('[')) {
    try {
      const v: unknown = JSON.parse(t);
      if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim());
    } catch {
      /* fall through to sentence split */
    }
  }
  return t.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
}

const FIELDS: RecordField[] = ['procedures', 'capability', 'equipment', 'description'];

/**
 * Up to `max` distinct sentences from the record that mention the service, most specific fields first
 * (procedures, capability, equipment, then the free-text description). Empty when the record never mentions it.
 */
export function quotesFor(record: FacilityRecord, key: string, name: string, max = 2): Quote[] {
  const terms = serviceTerms(key, name);
  const seen = new Set<string>();
  const out: Quote[] = [];
  for (const field of FIELDS) {
    for (const text of items(record[field])) {
      const low = ` ${text.toLowerCase()} `;
      if (!terms.some((term) => low.includes(term))) continue;
      const norm = low.replace(/\W+/g, ' ').trim();
      if (seen.has(norm)) continue;
      seen.add(norm);
      out.push({ text: text.length > 220 ? `${text.slice(0, 217)}…` : text, field });
      if (out.length >= max) return out;
    }
  }
  return out;
}

/** Record fields the platinum evidence for this service came from, in plain words (e.g. "specialty list, description"). */
export function channelsFor(record: FacilityRecord, key: string): string[] {
  const entry = record.channels.split('|').find((s) => s.startsWith(`${key}:`));
  if (!entry) return [];
  const label: Record<string, string> = {
    specialty_claim: 'specialty list', procedure: 'procedures list', capability: 'capabilities list', equipment: 'equipment list',
    description: 'description', rescued_capability: 'capabilities list', rescued_equipment: 'equipment list',
  };
  return [...new Set(entry.slice(key.length + 1).split(',').map((c) => label[c] ?? c.replace(/_/g, ' ')))];
}

/** Website domains the record was built from, as plain text references (not links). */
export function sourceDomains(record: FacilityRecord): string[] {
  return [...new Set(items(record.source_urls).map((u) => u.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split(/[/?#]/)[0]).filter(Boolean))];
}
