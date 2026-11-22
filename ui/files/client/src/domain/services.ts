import registryJson from '../../../config/service_registry.json';

/**
 * The 192-service vocabulary, generated from the platinum service catalog
 * (config/service_registry.json, scripts/export_registry.py). This module
 * replaces the old 12 heart labels (domain/labels.ts): every service a
 * facility may list, its confidence band, and the needs model used for
 * ranking all live here.
 *
 * Service keys are validated at runtime (isServiceKey), the same way
 * symptom ids are -- the vocabulary is generated data, not a hand-written
 * union type.
 */

export interface RegistryEntry {
  key: string;
  name: string;
  /** 'curated' (human-reviewed) or 'draft' (auto-generated from the camelCase key). */
  nameSource: 'curated' | 'draft';
  type: string;
  parent: string;
  critical: boolean;
  minFacilityClass: string | null;
  minDoctors: number | null;
  /** Catalog service keys whose evidence corroborates this service. */
  required: string[];
  supporting: string[];
}

interface RegistryFile {
  status: string;
  services: RegistryEntry[];
}

const registry = registryJson as RegistryFile;

/** The full 192-service registry, in catalog order. */
export const SERVICES: readonly RegistryEntry[] = registry.services;
export const SERVICE_KEYS: readonly string[] = registry.services.map((s) => s.key);
export const REGISTRY_STATUS: string = registry.status;

/** A service key from the 192-service catalog. Validated with isServiceKey. */
export type ServiceKey = string;

export function isServiceKey(value: string): value is ServiceKey {
  return (SERVICE_KEYS as readonly string[]).includes(value);
}

export function serviceName(key: ServiceKey): string {
  return registry.services.find((s) => s.key === key)?.name ?? key;
}

export function registryEntry(key: ServiceKey): RegistryEntry | undefined {
  return registry.services.find((s) => s.key === key);
}

/** Confidence band from the platinum facility_service_confidence table. */
export type Band = 'high' | 'medium' | 'unverified' | 'low';

/** Match points per band (RECOMMENDER_PLAN.md §7 / recommend.py CONF_SCORE). */
export const CONF_SCORE: Record<Band, number> = { high: 1.0, medium: 0.5, unverified: 0.3, low: 0.05 };

/** Plain-words band labels, shown with evidence in the UI. */
export const BAND_LABEL: Record<Band, string> = {
  high: 'Well-evidenced',
  medium: 'Some evidence',
  unverified: 'Single unverified mention',
  low: 'Doubtful (contradicted by facility size)',
};

export interface ServiceEvidence {
  band: Band;
  /** Independent source channels that mention the service (0-4). */
  channels: number;
  /** Catalog requirements with no evidence in this record. */
  missing: number;
}

/**
 * Parses the compact per-facility map from config/queries/candidates.sql:
 * "cardiology:high:3:0|dialysis:medium:1:2" -> Map { cardiology => {high, 3, 0}, ... }.
 * A service absent from the map has no evidence rows for this facility:
 * unknown, not disproven.
 */
export function parseServices(raw: string): Map<ServiceKey, ServiceEvidence> {
  const out = new Map<ServiceKey, ServiceEvidence>();
  if (!raw) return out;
  for (const entry of raw.split('|')) {
    if (!entry) continue;
    const [key, band, channels, missing] = entry.split(':');
    if (!isServiceKey(key)) continue; // never trust a name outside the registry
    if (band !== 'high' && band !== 'medium' && band !== 'unverified' && band !== 'low') continue;
    out.set(key, { band, channels: Math.max(0, Number(channels) || 0), missing: Math.max(0, Number(missing) || 0) });
  }
  return out;
}

/** Band score helper: absent service scores 0 (unknown is never negative). */
export function confScore(band: Band | undefined): number {
  return band === undefined ? 0 : CONF_SCORE[band];
}

/** The old evidence tiers, now derived from bands (ranking keeps the shape). */
export function bandTier(band: Band | undefined): 'A' | 'B' | 'C' | 'D' {
  if (band === 'high') return 'A';
  if (band === 'medium') return 'B';
  if (band === 'unverified') return 'C';
  return 'D'; // low or no evidence
}

/**
 * One weighted need over the catalog, as returned by the LLM needs
 * extraction (config/queries/needs_extract.sql) or the symptom map.
 * weight 0-1 (1.0 = the primary need), critical = must-have.
 */
export interface Need {
  service: ServiceKey;
  weight: number;
  critical: boolean;
}

/**
 * Patient conditions -> catalog services to credit (ordering boosts only;
 * never hides a place). Keys verified against the 192-service registry.
 */
export const CONDITION_SERVICES: Record<'pregnant' | 'kidney' | 'stroke' | 'diabetes', readonly ServiceKey[]> = {
  pregnant: ['gynecologyAndObstetrics', 'nicu', 'neonatologyPerinatalMedicine'],
  kidney: ['dialysis'],
  stroke: ['neurology'],
  diabetes: ['endocrinologyAndDiabetesAndMetabolism'],
};

/** General-care services credited when the patient is a child (under 18). */
export const CHILD_SERVICES: readonly ServiceKey[] = ['pediatrics'];

/**
 * The critical-need HARD FILTER (user decision, RECOMMENDER_PLAN.md §7):
 * a facility is kept only if EVERY critical need has high or medium
 * evidence. Missing, unverified or low evidence on a critical need
 * excludes the facility entirely.
 */
export function passesCriticalFilter(services: Map<ServiceKey, ServiceEvidence>, needs: readonly Need[]): boolean {
  return needs
    .filter((n) => n.critical)
    .every((n) => {
      const ev = services.get(n.service);
      return ev !== undefined && (ev.band === 'high' || ev.band === 'medium');
    });
}
