import { SERVICES, type Need } from './services';

/**
 * A "specific service" request: what the user asks for (dialysis, MRI, emergency C-section...),
 * expressed as weighted needs over the 192-service catalog. Exactly one need is critical
 * (hard filter in ranking); the rest only order.
 */
export interface ServiceRequest {
  id: string;
  name: string;
  aliases: string[];
  needs: Need[];
  urgent: boolean;
  note?: string;
}

const n = (service: string, weight: number, critical = false): Need => ({ service, weight, critical });

/** Composites for things the catalog has no single entry for. */
export const CURATED: ServiceRequest[] = [
  {
    id: 'emergencyCSection',
    name: 'Emergency C-section',
    aliases: ['c-section', 'c section', 'caesarean', 'cesarean', 'emergency delivery'],
    urgent: true,
    needs: [n('gynecologyAndObstetrics', 1, true), n('operationTheatre', 0.8), n('emergencyCare', 0.8), n('anesthesia', 0.6), n('bloodBank', 0.6), n('nicu', 0.4)],
    note: "The data has no 'C-section' entry, so we look for obstetrics (required) plus an operation theatre, emergency care, anaesthesia, a blood bank and a NICU.",
  },
  {
    id: 'highRiskDelivery',
    name: 'High-risk delivery',
    aliases: ['high risk pregnancy', 'delivery', 'labour', 'labor', 'maternity'],
    urgent: true,
    needs: [n('gynecologyAndObstetrics', 1, true), n('maternalFetalMedicineOrPerinatology', 0.8), n('nicu', 0.8), n('bloodBank', 0.6), n('operationTheatre', 0.6)],
    note: "The data has no 'high-risk delivery' entry, so we look for obstetrics (required) plus maternal-fetal medicine, a NICU, a blood bank and an operation theatre.",
  },
  {
    id: 'burnCare',
    name: 'Burn care',
    aliases: ['burn', 'burns', 'burn unit'],
    urgent: true,
    needs: [n('plasticSurgery', 1, true), n('reconstructivePlasticSurgery', 0.6), n('woundCare', 0.6), n('icu', 0.6), n('emergencyCare', 0.6)],
    note: "The data has no 'burn care' entry; burn units usually sit under plastic surgery, so we require plastic surgery and look for wound care, ICU and emergency care.",
  },
  {
    id: 'traumaCare',
    name: 'Trauma / accident care',
    aliases: ['trauma', 'accident', 'road accident', 'injury'],
    urgent: true,
    needs: [n('emergencyCare', 1, true), n('orthopedicSurgery', 0.8), n('icu', 0.8), n('ctScanner', 0.6), n('neurosurgery', 0.6), n('bloodBank', 0.6), n('ambulanceService', 0.5)],
    note: "The data has no 'trauma care' entry, so we require emergency care and look for orthopaedic surgery, ICU, a CT scanner, neurosurgery, a blood bank and an ambulance service.",
  },
];

const ALIASES: Record<string, string[]> = {
  mriScanner: ['mri', 'mri scan', 'magnetic resonance'],
  ctScanner: ['ct', 'ct scan', 'cat scan'],
  dialysis: ['kidney dialysis', 'haemodialysis', 'hemodialysis'],
  nicu: ['neonatal icu', 'newborn icu', 'baby icu'],
  cardiacSurgery: ['heart surgery', 'valve surgery', 'cardiac surgery'],
  cabgSurgery: ['bypass', 'cabg'],
  angioplasty: ['stent', 'angiography'],
  chemotherapy: ['chemo', 'cancer treatment'],
  ultrasoundImaging: ['ultrasound', 'sonography'],
  xrayImaging: ['x-ray', 'xray'],
  icu: ['intensive care'],
  emergencyCare: ['emergency', 'casualty', 'er'],
  ivf: ['test tube baby'],
  kidneyTransplant: ['kidney transplant', 'renal transplant'],
  jointReplacementSurgery: ['knee replacement', 'hip replacement'],
  cataractSurgery: ['cataract'],
  bloodBank: ['blood'],
  pediatrics: ['child', 'children', 'paediatrics'],
  gynecologyAndObstetrics: ['gynaecology', 'obstetrics', 'pregnancy'],
  oncology: ['cancer'],
  psychiatry: ['mental health'],
  neurology: ['stroke', 'epilepsy'],
};

const URGENT_KEYS = ['emergencyCare', 'icu', 'nicu', 'emergencyMedicine', 'criticalCareMedicine', 'ambulanceService'];

const catalog: ServiceRequest[] = SERVICES.map((s) => ({
  id: s.key,
  name: s.name,
  aliases: ALIASES[s.key] ?? [],
  needs: [n(s.key, 1, true)],
  urgent: URGENT_KEYS.includes(s.key),
}));

export const ALL_REQUESTS: ServiceRequest[] = [...CURATED, ...catalog];

const byId = new Map(ALL_REQUESTS.map((r) => [r.id, r]));
export const requestById = (id: string): ServiceRequest | undefined => byId.get(id);

export const QUICK_REQUESTS: string[] = ['dialysis', 'emergencyCSection', 'nicu', 'cardiacSurgery', 'mriScanner', 'burnCare', 'traumaCare', 'highRiskDelivery'];

function score(r: ServiceRequest, q: string): number {
  let best = Infinity;
  for (const term of [r.name, ...r.aliases]) {
    const x = term.toLowerCase();
    const v = x === q ? 0 : x.startsWith(q) ? 1 : x.split(/[\s/-]+/).some((w) => w.startsWith(q)) ? 2 : x.includes(q) ? 3 : Infinity;
    best = Math.min(best, v);
  }
  return best;
}

export function searchRequests(q: string, max = 8): ServiceRequest[] {
  const query = q.trim().toLowerCase();
  if (query.length < 2) return [];
  return ALL_REQUESTS.map((r, i) => ({ r, i, sc: score(r, query) }))
    .filter((x) => x.sc < Infinity)
    .sort((a, b) => a.sc - b.sc || a.i - b.i)
    .slice(0, max)
    .map((x) => x.r);
}

/** The one required (critical) service of a request, '' when there is no request. The candidates query filters on it. */
export function requiredService(id: string | null | undefined): string {
  if (!id) return '';
  return requestById(id)?.needs.find((n) => n.critical)?.service ?? '';
}
