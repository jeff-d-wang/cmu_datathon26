// Output contract of find_facilities(query, pin, top_k) from the recommender notebook.
export type NeedTuple = [service: string, share: number, ciLo: number | null, ciHi: number | null];
export interface Need { service: string; share: number; ciLo: number | null; ciHi: number | null }

export type EngineConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface EngineResult {
  rank: number;
  facility_id: string;
  name: string;
  city: string;
  type: string;
  km: number;
  /** match x relevance x distance x trust. Not a probability. */
  score: number;
  match: number;
  relevance: number;
  relevance_reason: string;
  trust: number;
  location_flags: string[];
  confidence: EngineConfidence;
  confidence_reasons: string[];
  evidence: Record<string, string>;
  /** Not part of the notebook contract; present only if a live source supplies them. */
  lat?: number;
  lon?: number;
  phone?: string;
  website?: string;
  state?: string;
  pin?: string;
  capacity?: number | null;
  /** Grade of each piece of evidence: documented_multi / documented_single / structured_field / tag_only. */
  evidence_status?: Record<string, string>;
}

export interface EngineMeta { advisory: string; critical: boolean; source: string }

/** One find_facilities call plus the request it answered (as stored in the fixture). */
export interface EngineEntry {
  query: string;
  code?: number;
  pin: string;
  label: string;
  source: string;
  tolerance_km: number;
  escalation?: string;
  alternates: string[];
  needs: NeedTuple[];
  meta: EngineMeta;
  results: EngineResult[];
}

export const parseNeeds = (needs: readonly NeedTuple[]): Need[] =>
  needs.map(([service, share, ciLo, ciHi]) => ({ service, share, ciLo: ciLo ?? null, ciHi: ciHi ?? null }));

/** Distance factor: 1/(1+(km/tau)^2); tau is the entry's tolerance (15 km critical, else 40). */
export const distanceFactor = (km: number, tauKm: number): number => 1 / (1 + (km / tauKm) ** 2);
