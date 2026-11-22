import { useMemo, type ReactNode } from 'react';
import { useAnalyticsQuery } from '@databricks/appkit-ui/react';
import { sql } from '@databricks/appkit-ui/js';

/** District health rating (config/queries/district_rating.sql). Missing numbers are null. */
export interface DistrictRating {
  district_name: string;
  state_ut: string;
  access_status: string;
  band_equal: string;
  composite: number | null;
  n_facilities: number | null;
  doctors_per_fac: number | null;
  critical_cov: number | null;
  score_maternal: number | null;
  score_immunisation: number | null;
  score_ncd: number | null;
  score_access: number | null;
  n_districts: number | null;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const text = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '');

export function DistrictRatingQuery({ state, district, children }: { state: string; district: string; children: (row: DistrictRating | null, loading: boolean) => ReactNode }) {
  const enabled = Boolean(state && district);
  const params = useMemo(() => ({ state: sql.string(state), district: sql.string(district) }), [state, district]);
  const { data, loading } = useAnalyticsQuery('district_rating', params, { autoStart: enabled });
  const row = useMemo<DistrictRating | null>(() => {
    const r = enabled ? data?.[0] : undefined;
    return r ? {
      district_name: text(r.district_name), state_ut: text(r.state_ut), access_status: text(r.access_status), band_equal: text(r.band_equal),
      composite: num(r.composite), n_facilities: num(r.n_facilities), doctors_per_fac: num(r.doctors_per_fac), critical_cov: num(r.critical_cov),
      score_maternal: num(r.score_maternal), score_immunisation: num(r.score_immunisation), score_ncd: num(r.score_ncd),
      score_access: num(r.score_access), n_districts: num(r.n_districts),
    } : null;
  }, [data, enabled]);
  return <>{children(row, enabled && loading)}</>;
}
