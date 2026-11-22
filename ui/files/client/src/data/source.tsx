import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useAnalyticsQuery } from '@databricks/appkit-ui/react';
import { sql } from '@databricks/appkit-ui/js';
import type { Facility } from '../domain/types';
import type { Place } from '../domain/places';
import type { BBox } from '../domain/geo';
import { SAMPLE_FACILITIES, SAMPLE_PLACES, SAMPLE_STATES } from '../sample/sampleData';

/**
 * Data source switch (client env VITE_DATA_SOURCE):
 *   sample (default) - bundled fictional places, runs offline
 *   raw              - live read-only queries on the original Virtue Foundation tables
 *   clean            - live read-only queries on the team's cleaned table labuser_jdw2.gold.facility_district_health_indicators
 * The legacy flag VITE_USE_SAMPLE_DATA=false still means "raw".
 */
export type DataSource = 'sample' | 'raw' | 'clean';
const envSource = String(import.meta.env.VITE_DATA_SOURCE ?? '');
export const DATA_SOURCE: DataSource =
  envSource === 'clean' || envSource === 'raw' || envSource === 'sample'
    ? envSource
    : import.meta.env.VITE_USE_SAMPLE_DATA === 'false'
      ? 'raw'
      : 'sample';
export const USE_SAMPLE: boolean = DATA_SOURCE === 'sample';

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

/** Typed mapper: JSON rows can carry booleans/numbers as strings at runtime. */
export function toFacility(r: Record<string, unknown>): Facility {
  return {
    unique_id: str(r.unique_id), name: str(r.name), facility_type: str(r.facility_type), ownership: str(r.ownership),
    city: str(r.city), state: str(r.state), district: str(r.district), pin: str(r.pin),
    lat: Number(r.lat), lon: Number(r.lon), loc_approx: bool(r.loc_approx),
    label_fields: str(r.label_fields), label_quotes: str(r.label_quotes), has_service_text: bool(r.has_service_text),
    list_truncated: bool(r.list_truncated), merge_suspect: bool(r.merge_suspect), merge_signals: Number(r.merge_signals) || 0,
    source_class: str(r.source_class), small_facility: bool(r.small_facility), single_specialty_name: bool(r.single_specialty_name),
    doctors: num(r.doctors), beds: num(r.beds), emergency_claim: bool(r.emergency_claim), claims_247: bool(r.claims_247),
    ambulance: bool(r.ambulance), icu_equipment: bool(r.icu_equipment), equipment_listed: bool(r.equipment_listed),
    icu_claim: bool(r.icu_claim), cath_equipment: bool(r.cath_equipment), has_obgyn: bool(r.has_obgyn), has_nicu: bool(r.has_nicu),
    has_dialysis: bool(r.has_dialysis), has_neuro_stroke: bool(r.has_neuro_stroke), has_diabetes_care: bool(r.has_diabetes_care),
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
  const { data, loading, error, warehouseStatus } = useAnalyticsQuery('heart_candidates', params);
  useQueryTiming('heart_candidates', loading, data?.length ?? 0);
  const rows = useMemo(() => (data ?? []).map((r) => toFacility(r)), [data]);
  return <>{children({ rows, loading, error, warming: warmingState(warehouseStatus), sample: false })}</>;
}

function LiveCandidatesClean({ bbox, children }: { bbox: BBox; children: (l: Loaded<Facility[]>) => ReactNode }) {
  const params = useMemo(() => bboxParams(bbox), [bbox]);
  const { data, loading, error, warehouseStatus } = useAnalyticsQuery('heart_candidates_clean', params);
  useQueryTiming('heart_candidates_clean', loading, data?.length ?? 0);
  const rows = useMemo(() => (data ?? []).map((r) => toFacility(r)), [data]);
  return <>{children({ rows, loading, error, warming: warmingState(warehouseStatus), sample: false })}</>;
}

export function Candidates({ bbox, children }: { bbox: BBox; children: (l: Loaded<Facility[]>) => ReactNode }) {
  if (DATA_SOURCE === 'sample') return <>{children({ rows: SAMPLE_FACILITIES, loading: false, error: null, warming: false, sample: true })}</>;
  if (DATA_SOURCE === 'clean') return <LiveCandidatesClean bbox={bbox}>{children}</LiveCandidatesClean>;
  return <LiveCandidates bbox={bbox}>{children}</LiveCandidates>;
}

export interface EmergencyPlace {
  unique_id: string;
  name: string;
  lat: number;
  lon: number;
  claims_247: boolean;
  official_phone: string;
}

function LiveEmergency({ bbox, children }: { bbox: BBox; children: (l: Loaded<EmergencyPlace[]>) => ReactNode }) {
  const params = useMemo(() => bboxParams(bbox), [bbox]);
  const { data, loading, error, warehouseStatus } = useAnalyticsQuery('emergency_candidates', params);
  useQueryTiming('emergency_candidates', loading, data?.length ?? 0);
  const rows = useMemo(
    () => (data ?? []).map((r) => ({ unique_id: str(r.unique_id), name: str(r.name), lat: Number(r.lat), lon: Number(r.lon), claims_247: bool(r.claims_247), official_phone: str(r.official_phone) })),
    [data],
  );
  return <>{children({ rows, loading, error, warming: warmingState(warehouseStatus), sample: false })}</>;
}

function LiveEmergencyClean({ bbox, children }: { bbox: BBox; children: (l: Loaded<EmergencyPlace[]>) => ReactNode }) {
  const params = useMemo(() => bboxParams(bbox), [bbox]);
  const { data, loading, error, warehouseStatus } = useAnalyticsQuery('emergency_candidates_clean', params);
  useQueryTiming('emergency_candidates_clean', loading, data?.length ?? 0);
  const rows = useMemo(
    () => (data ?? []).map((r) => ({ unique_id: str(r.unique_id), name: str(r.name), lat: Number(r.lat), lon: Number(r.lon), claims_247: bool(r.claims_247), official_phone: str(r.official_phone) })),
    [data],
  );
  return <>{children({ rows, loading, error, warming: warmingState(warehouseStatus), sample: false })}</>;
}

export function EmergencyPlaces({ bbox, children }: { bbox: BBox; children: (l: Loaded<EmergencyPlace[]>) => ReactNode }) {
  if (DATA_SOURCE === 'clean') return <LiveEmergencyClean bbox={bbox}>{children}</LiveEmergencyClean>;
  if (USE_SAMPLE) {
    const rows = SAMPLE_FACILITIES.filter((f) => f.emergency_claim).map((f) => ({ unique_id: f.unique_id, name: f.name, lat: f.lat, lon: f.lon, claims_247: f.claims_247, official_phone: f.official_phone }));
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
