import { useMemo, type ReactNode } from 'react';
import { useAnalyticsQuery } from '@databricks/appkit-ui/react';
import { sql } from '@databricks/appkit-ui/js';
import { toTeamRow, type TeamRow } from '../domain/team';

export function TeamRankQuery({ origin, needs, children }: {
  origin: { lat: number; lon: number };
  needs: readonly { service: string; weight: number; critical: boolean }[];
  children: (l: { rows: TeamRow[]; loading: boolean; error: string | null }) => ReactNode;
}) {
  const params = useMemo(() => ({
    lat: sql.double(origin.lat), lon: sql.double(origin.lon), max_km: sql.double(300),
    needs_json: sql.string(JSON.stringify(needs.map(({ service, weight, critical }) => ({ service, weight, critical })))),
    row_cap: sql.double(1500),
  }), [origin.lat, origin.lon, needs]);
  const { data, loading, error } = useAnalyticsQuery('team_rank', params);
  const rows = useMemo(() => (data ?? []).map((r) => toTeamRow(r as Record<string, unknown>)), [data]);
  return <>{children({ rows, loading, error })}</>;
}
