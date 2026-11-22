/** Team ranking (src/recommend.py rank + src/hybrid_recommend.py never-empty ladder), ported for display. */
export interface TeamRow {
  unique_id: string; name: string; facility_class: string | null; km: number; coord_source: string;
  lat: number; lon: number; nabh: boolean; beds: number | null; n_needs_met: number;
  matched: Record<string, string>; score: number; crit_fail: boolean;
}

export const CLASS_RANK: Record<string, number> = { pharmacy: 1, physiotherapy_rehab: 2, diagnostic_center: 3, dental_clinic: 4, clinic: 5, hospital: 6 };
export const RADIUS_LADDER_KM = [25, 50, 100, 300];
export const GENERIC_NEEDS = [{ service: 'emergencyCare', weight: 1.0, critical: false }];
export const GENERIC_BANNER = 'GENERIC_FALLBACK: ranking nearest facilities for general emergency care; LOW confidence by design';
export const EMPTY_BANNER = 'no facilities in dataset within 300 km of this PIN';
export const UNMET_NOTE = 'no evidence found (unknown, not disproven -- absence of evidence is not evidence of absence)';
const CRIT_BANNER = 'CRITICAL_UNAVAILABLE: no facility within 300 km documents the critical service; showing best available without it';

const bool = (v: unknown) => v === true || v === 'true';
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '');
const n = (v: unknown, d = 0) => { const x = v === null || v === undefined || v === '' ? NaN : Number(v); return Number.isFinite(x) ? x : d; };

export function toTeamRow(r: Record<string, unknown>): TeamRow {
  let matched: Record<string, string> = {};
  try {
    const m: unknown = typeof r.matched_json === 'string' ? JSON.parse(r.matched_json) : r.matched_json;
    if (m && typeof m === 'object') matched = Object.fromEntries(Object.entries(m as Record<string, unknown>).map(([k, v]) => [k, String(v)]));
  } catch { /* leave empty */ }
  const beds = r.beds === null || r.beds === undefined || r.beds === '' || !Number.isFinite(Number(r.beds)) ? null : Number(r.beds);
  return {
    unique_id: str(r.unique_id), name: str(r.name),
    facility_class: typeof r.facility_class === 'string' && r.facility_class ? r.facility_class : null,
    km: n(r.km), coord_source: str(r.coord_source), lat: n(r.lat), lon: n(r.lon),
    nabh: bool(r.nabh), beds, n_needs_met: n(r.n_needs_met), matched, score: n(r.score), crit_fail: bool(r.crit_fail),
  };
}

export function teamCompare(a: TeamRow, b: TeamRow): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.nabh !== b.nabh) return a.nabh ? -1 : 1;
  if (a.beds !== b.beds) {
    if (a.beds === null) return 1;
    if (b.beds === null) return -1;
    return b.beds - a.beds;
  }
  const ca = CLASS_RANK[a.facility_class ?? ''] ?? 0;
  const cb = CLASS_RANK[b.facility_class ?? ''] ?? 0;
  if (ca !== cb) return cb - ca;
  if (a.km !== b.km) return a.km - b.km;
  return a.unique_id < b.unique_id ? -1 : a.unique_id > b.unique_id ? 1 : 0;
}

export function teamLadder(rows: TeamRow[]): { rows: TeamRow[]; radiusKm: number; banners: string[]; mode: 'normal' | 'softened' | 'empty' } {
  const banners: string[] = [];
  for (const r of RADIUS_LADDER_KM) {
    const ok = rows.filter((x) => !x.crit_fail && x.km <= r);
    if (ok.length) return { rows: ok.sort(teamCompare), radiusKm: r, banners, mode: 'normal' };
    banners.push(`no ranked match within ${r} km; widened search`);
  }
  banners.push(CRIT_BANNER);
  for (const r of RADIUS_LADDER_KM) {
    const ok = rows.filter((x) => x.km <= r);
    if (ok.length) return { rows: ok.sort(teamCompare), radiusKm: r, banners, mode: 'softened' };
  }
  return { rows: [], radiusKm: 300, banners, mode: 'empty' };
}

export function bannerText(b: string): string {
  const m = /^no ranked match within (\d+) km; widened search$/.exec(b);
  if (m) return `Nothing matched within ${m[1]} km, so the search widened.`;
  if (b.startsWith('CRITICAL_UNAVAILABLE')) return 'No place within 300 km documents the required service; showing the best available without it.';
  if (b.startsWith('GENERIC_FALLBACK')) return 'Nothing matched your needs, so these are the nearest places with emergency care (low confidence by design).';
  if (b === EMPTY_BANNER) return 'No facilities in our data within 300 km.';
  return b;
}
