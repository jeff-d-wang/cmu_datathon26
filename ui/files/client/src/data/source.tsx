import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useAnalyticsQuery } from '@databricks/appkit-ui/react';
import { sql } from '@databricks/appkit-ui/js';
import type { Facility } from '../domain/types';
import type { Place } from '../domain/places';
import type { BBox } from '../domain/geo';
import { SAMPLE_FACILITIES, SAMPLE_PLACES, SAMPLE_STATES } from '../sample/sampleData';

/**
 * Data source switch (client env VITE_DATA_SOURCE):
 *   sample   (default) - bundled fictional places, runs offline
 *   platinum - live read-only queries backed by the team's platinum evidence tables
 *              (gold.facility_district_health_indicators + platinum.facility_service_confidence)
 * Legacy values 'raw' and 'clean', and VITE_USE_SAMPLE_DATA=false, now mean platinum:
 * the platinum-backed candidates query replaced the old heart/raw/clean ones.
 */
export type DataSource = 'sample' | 'platinum';
const envSource = String(import.meta.env.VITE_DATA_SOURCE ?? '');
export const DATA_SOURCE: DataSource =
  envSource === 'sample' || envSource === 'platinum'
    ? envSource
    : import.meta.env.VITE_USE_SAMPLE_DATA === 'false' || envSource === 'raw' || envSource === 'clean'
      ? 'platinum'
      : 'sample';
export const USE_SAMPLE: boolean = DATA_SOURCE === 'sample';

/** Layer B LLM needs extraction: runs inside the workspace (ai_query via needs_extract.sql), off by default. */
export const LLM_EXTRACTION: boolean = DATA_SOURCE === 'platinum' && String(import.meta.env.VITE_LLM_EXTRACTION ?? '') === 'true';

export interface Loaded<T> {
  rows: T;
  loading: boolean;
  error: string | null;
  warming: boolean;
  sample: boolean;
}

const bool = (v: unknown) => v === true || v === 'true';
const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '');

/** Typed mapper for the 35-column platinum contract (config/queries/candidates.sql). */
export function toFacility(r: Record<string, unknown>): Facility {
  return {
    unique_id: str(r.unique_id), name: str(r.name), facility_class: str(r.facility_class), ownership: str(r.ownership),
    city: str(r.city), state: str(r.state), district: str(r.district), pin: str(r.pin),
    lat: Number(r.lat), lon: Number(r.lon), loc_approx: bool(r.loc_approx),
    services: str(r.services), n_services: Number(r.n_services) || 0, n_high: Number(r.n_high) || 0,
    list_truncated: bool(r.list_truncated), merge_suspect: bool(r.merge_suspect), merge_signals: Number(r.merge_signals) || 0,
    source_class: str(r.source_class), small_facility: bool(r.small_facility), single_specialty_name: bool(r.single_specialty_name),
    doctors: num(r.doctors), beds: num(r.beds),
    claims_247: bool(r.claims_247), ambulance: bool(r.ambulance), icu_equipment: bool(r.icu_equipment), equipment_listed: bool(r.equipment_listed),
    says_nabh: bool(r.says_nabh), emergency_quote: str(r.emergency_quote), icu_quote: str(r.icu_quote), nabh_quote: str(r.nabh_quote),
    official_phone: str(r.official_phone), official_phone_shared_by: Number(r.official_phone_shared_by) || 0,
    alt_phone: str(r.alt_phone), website: str(r.website), address: str(r.address),
  };
}

function toPlace(r: Record<string, unknown>): Place {
  return { kind: str(r.kind), code: str(r.code), district: str(r.district), state: str(r.state), towns: str(r.towns), lat: Number(r.lat), lon: Number(r.lon) };
}

const bboxParams = (b: BBox) => ({
  min_lat: sql.double(b.minLat),
  max_lat: sql.double(b.maxLat),
  min_lon: sql.double(b.minLon),
  max_lon: sql.double(b.maxLon),
});

/** Dev only: logs query name, duration and row count. Never params or user input. */
function useQueryTiming(queryKey: string, loading: boolean, n: number) {
  const t0 = useRef(0);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    if (loading || !t0.current) t0.current = performance.now();
    if (!loading) console.info(`[query] ${queryKey} ${Math.round(performance.now() - t0.current)} ms, ${n} rows`);
  }, [queryKey, loading, n]);
}

const warmingState = (s: { state: string } | null) => s !== null && s.state !== 'RUNNING';

// ---- Live components: mounted only in live mode, so the hooks never run against sample data. ----

function LiveCandidates({ bbox, children }: { bbox: BBox; children: (l: Loaded<Facility[]>) => ReactNode }) {
  const params = useMemo(() => bboxParams(bbox), [bbox]);
  const { data, loading, error, warehouseStatus } = useAnalyticsQuery('candidates', params);
  useQueryTiming('candidates', loading, data?.length ?? 0);
  const rows = useMemo(() => (data ?? []).map((r) => toFacility(r)), [data]);
  return <>{children({ rows, loading, error, warming: warmingState(warehouseStatus), sample: false })}</>;
}

export function Candidates({ bbox, children }: { bbox: BBox; children: (l: Loaded<Facility[]>) => ReactNode }) {
  if (USE_SAMPLE) return <>{children({ rows: SAMPLE_FACILITIES, loading: false, error: null, warming: false, sample: true })}</>;
  return <LiveCandidates bbox={bbox}>{children}</LiveCandidates>;
}

export interface EmergencyPlace {
  unique_id: string;
  name: string;
  lat: number;
  lon: number;
  loc_approx: boolean;
  /** '' when the place matched only the regex fallback, not platinum emergencyCare evidence. */
  emergency_band: string;
  ambulance: boolean;
  claims_247: boolean;
  emergency_quote: string;
  official_phone: string;
}

function LiveEmergency({ bbox, children }: { bbox: BBox; children: (l: Loaded<EmergencyPlace[]>) => ReactNode }) {
  const params = useMemo(() => bboxParams(bbox), [bbox]);
  const { data, loading, error, warehouseStatus } = useAnalyticsQuery('emergency_candidates_platinum', params);
  useQueryTiming('emergency_candidates_platinum', loading, data?.length ?? 0);
  const rows = useMemo(
    () => (data ?? []).map((r) => ({
      unique_id: str(r.unique_id), name: str(r.name), lat: Number(r.lat), lon: Number(r.lon),
      loc_approx: bool(r.loc_approx), emergency_band: str(r.emergency_band), ambulance: bool(r.ambulance),
      claims_247: bool(r.claims_247), emergency_quote: str(r.emergency_quote), official_phone: str(r.official_phone),
    })),
    [data],
  );
  return <>{children({ rows, loading, error, warming: warmingState(warehouseStatus), sample: false })}</>;
}

export function EmergencyPlaces({ bbox, children }: { bbox: BBox; children: (l: Loaded<EmergencyPlace[]>) => ReactNode }) {
  if (USE_SAMPLE) {
    const rows = SAMPLE_FACILITIES.filter((f) => f.services.includes('emergencyCare:')).map((f) => ({
      unique_id: f.unique_id, name: f.name, lat: f.lat, lon: f.lon, loc_approx: f.loc_approx,
      emergency_band: f.services.split('|').find((s) => s.startsWith('emergencyCare:'))?.split(':')[1] ?? '',
      ambulance: f.ambulance, claims_247: f.claims_247, emergency_quote: f.emergency_quote, official_phone: f.official_phone,
    }));
    return <>{children({ rows, loading: false, error: null, warming: false, sample: true })}</>;
  }
  return <LiveEmergency bbox={bbox}>{children}</LiveEmergency>;
}

function LiveStates({ children }: { children: (l: Loaded<string[]>) => ReactNode }) {
  const { data, loading, error, warehouseStatus } = useAnalyticsQuery('states', {});
  useQueryTiming('states', loading, data?.length ?? 0);
  const rows = useMemo(() => (data ?? []).map((r) => str(r.state)), [data]);
  return <>{children({ rows, loading, error, warming: warmingState(warehouseStatus), sample: false })}</>;
}

export function States({ children }: { children: (l: Loaded<string[]>) => ReactNode }) {
  if (USE_SAMPLE) return <>{children({ rows: SAMPLE_STATES, loading: false, error: null, warming: false, sample: true })}</>;
  return <LiveStates>{children}</LiveStates>;
}

function LivePlaces({ state, children }: { state: string; children: (l: Loaded<Place[]>) => ReactNode }) {
  const params = useMemo(() => ({ state: sql.string(state) }), [state]);
  const { data, loading, error, warehouseStatus } = useAnalyticsQuery('place_lookup', params);
  useQueryTiming('place_lookup', loading, data?.length ?? 0);
  const rows = useMemo(() => (data ?? []).map((r) => toPlace(r)), [data]);
  return <>{children({ rows, loading, error, warming: warmingState(warehouseStatus), sample: false })}</>;
}

export function Places({ state, children }: { state: string; children: (l: Loaded<Place[]>) => ReactNode }) {
  if (USE_SAMPLE) return <>{children({ rows: SAMPLE_PLACES.filter((p) => p.state === state), loading: false, error: null, warming: false, sample: true })}</>;
  return <LivePlaces state={state}>{children}</LivePlaces>;
}

export interface ExtractedNeed {
  service: string;
  weight: number;
  critical: boolean;
}

/**
 * Layer B: LLM needs extraction, run inside the workspace (ai_query to system.ai.gpt-oss-120b
 * in needs_extract.sql). The prompt is a bound parameter and never logged. Mounted only when
 * LLM_EXTRACTION is on; the caller falls back to the in-browser symptom map when it is off.
 */
export function Needs({ prompt, children }: { prompt: string; children: (l: Loaded<ExtractedNeed[]>) => ReactNode }) {
  const params = useMemo(() => ({ prompt: sql.string(prompt) }), [prompt]);
  const { data, loading, error, warehouseStatus } = useAnalyticsQuery('needs_extract', params);
  useQueryTiming('needs_extract', loading, data?.length ?? 0);
  const rows = useMemo(
    () => (data ?? []).map((r) => ({ service: str(r.service), weight: Number(r.weight) || 0, critical: bool(r.critical) })),
    [data],
  );
  return <>{children({ rows, loading, error, warming: warmingState(warehouseStatus), sample: false })}</>;
}
