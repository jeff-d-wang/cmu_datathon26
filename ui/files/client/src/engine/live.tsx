import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useAnalyticsQuery } from '@databricks/appkit-ui/react';
import { sql } from '@databricks/appkit-ui/js';
import type { BBox } from '../domain/geo';
import type { EngineFacility } from './method';
import { toEngineFacility } from './rows';

export interface EngineLoaded { rows: EngineFacility[]; loading: boolean; error: string | null; warming: boolean }

/** engine_clean mode: read-only engine_candidates_clean for a coarse bbox (symptoms, age and sex are never sent). Dev only: logs rows, bytes, ms. */
export function EngineCandidates({ bbox, children }: { bbox: BBox; children: (l: EngineLoaded) => ReactNode }) {
  const params = useMemo(() => ({ min_lat: sql.double(bbox.minLat), max_lat: sql.double(bbox.maxLat), min_lon: sql.double(bbox.minLon), max_lon: sql.double(bbox.maxLon) }), [bbox]);
  const { data, loading, error, warehouseStatus } = useAnalyticsQuery('engine_candidates_clean', params);
  const t0 = useRef(0);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    if (loading || !t0.current) t0.current = performance.now();
    if (!loading) console.info(`[query] engine_candidates_clean ${Math.round(performance.now() - t0.current)} ms, ${data?.length ?? 0} rows, ${JSON.stringify(data ?? []).length} bytes`);
  }, [loading, data]);
  const rows = useMemo(() => (data ?? []).map((r) => toEngineFacility(r as unknown as Record<string, unknown>)), [data]);
  return <>{children({ rows, loading, error, warming: warehouseStatus !== null && warehouseStatus.state !== 'RUNNING' })}</>;
}
