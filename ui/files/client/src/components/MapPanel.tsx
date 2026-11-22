import { haversineKm, type Point } from '../domain/geo';
import { useT } from '../i18n';
import india from '../geo/india_outline.json';

/** India outline: Natural Earth 1:10m, India point of view (public domain), bundled; no network requests. */
const RINGS: number[][][] = india.rings;

function ringsPath(proj: (p: Point) => { x: number; y: number }): string {
  return RINGS.map((ring) => ring.map(([lon, lat], i) => { const q = proj({ lat, lon }); return `${i ? 'L' : 'M'}${q.x.toFixed(1)},${q.y.toFixed(1)}`; }).join('') + 'Z').join('');
}

export interface MapPoint {
  id: string;
  lat: number;
  lon: number;
  label: string;
  warn?: boolean;
}

/**
 * Schematic map: plain SVG, no map tiles, no external requests (privacy: the viewed area is never sent anywhere).
 * Equirectangular projection around the origin; lines are straight-line distance.
 * Markers are decorative for assistive tech: the result cards carry the same information and actions.
 */
export function SchematicMap({ origin, points, radiusKm, selectedId, onSelect, ariaLabel }: { origin: Point; points: MapPoint[]; radiusKm: number; selectedId?: string | null; onSelect?: (id: string) => void; ariaLabel: string }) {
  const t = useT();
  const far = Math.max(radiusKm, ...points.map((p) => haversineKm(origin, p))) * 1.15;
  const w = 800;
  const h = 800;
  const scale = (Math.min(w, h) / 2 - 40) / far;
  const kx = 111 * Math.cos((origin.lat * Math.PI) / 180);
  const proj = (p: Point) => ({ x: w / 2 + (p.lon - origin.lon) * kx * scale, y: h / 2 - (p.lat - origin.lat) * 111 * scale });
  const o = proj(origin);
  const crowded = points.some((p) => {
    const q = proj(p);
    return Math.hypot(q.x - o.x, q.y - o.y) < 60;
  });
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-full w-full" preserveAspectRatio="xMidYMid slice" role="img" aria-label={ariaLabel}>
      <rect x={-2000} y={-2000} width={w + 4000} height={h + 4000} fill="#dfe7ee" />
      <path d={ringsPath(proj)} fill="var(--hc-map)" stroke="#9fb2ab" strokeWidth={1.5} aria-hidden />
      <g aria-hidden>
        <circle cx={o.x} cy={o.y} r={radiusKm * scale} fill="none" stroke="var(--hc-primary)" strokeDasharray="8 6" strokeWidth={2} />
        <text x={o.x + radiusKm * scale * 0.7} y={o.y - radiusKm * scale * 0.72} fontSize={18} fill="var(--hc-primary-dark)" fontWeight={600}>
          {radiusKm} km
        </text>
        {points.map((p) => {
          const q = proj(p);
          return <line key={`l-${p.id}`} x1={o.x} y1={o.y} x2={q.x} y2={q.y} stroke="var(--hc-muted)" strokeDasharray="2 5" opacity={0.6} />;
        })}
        <circle cx={o.x} cy={o.y} r={9} fill="#2f6fde" stroke="#fff" strokeWidth={3} />
        <text x={crowded ? o.x - 14 : o.x + 14} y={o.y + 26} textAnchor={crowded ? 'end' : 'start'} fontSize={17} fontWeight={700} fill="#1d3f80">
          {t('you')}
        </text>
        {points.map((p) => {
          const q = proj(p);
          const sel = p.id === selectedId;
          return (
            <g key={p.id} transform={`translate(${q.x},${q.y})`} onClick={() => onSelect?.(p.id)} style={{ cursor: onSelect ? 'pointer' : 'default' }}>
              <circle r={sel ? 24 : 20} fill={p.warn ? '#fff' : 'var(--hc-primary)'} stroke={p.warn ? '#6a5400' : '#fff'} strokeWidth={p.warn ? 3 : 2} />
              <text textAnchor="middle" dy="0.35em" fontSize={17} fontWeight={700} fill={p.warn ? '#6a5400' : '#fff'}>
                {p.label}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}

/** Left-hand panel for onboarding screens: brand + note over a plain background (no fake facility dots). */
export function IntroPanel({ note }: { note: string }) {
  const t = useT();
  return (
    <div className="relative h-full bg-[#dfe7ee]">
      <IndiaOverview />
      <div className="absolute left-6 top-6 flex max-w-sm flex-col gap-3">
        <div className="rounded-lg bg-white px-3 py-2 text-[18px] font-bold text-[var(--hc-primary-dark)] shadow-sm">{t('app_name')}</div>
        <p className="rounded-lg bg-white/90 px-3 py-2 text-[16px] text-[var(--hc-text-2)] shadow-sm">{note}</p>
      </div>
    </div>
  );
}

/** Whole-India overview for the onboarding screens (decorative). */
function IndiaOverview({ marker, className }: { marker?: Point; className?: string } = {}) {
  const w = 800;
  const h = 800;
  const minLon = 67.5, maxLon = 97.8, minLat = 6, maxLat = 37.5;
  const k = Math.min((w - 80) / (maxLon - minLon), (h - 80) / (maxLat - minLat));
  const proj = (p: Point) => ({ x: 40 + (p.lon - minLon) * k + ((w - 80) - (maxLon - minLon) * k) / 2, y: 40 + (maxLat - p.lat) * k });
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={className ?? 'absolute inset-0 h-full w-full'} preserveAspectRatio="xMidYMid meet" aria-hidden>
      <path d={ringsPath(proj)} fill="var(--hc-map)" stroke="#9fb2ab" strokeWidth={2} />
      {marker && <circle cx={proj(marker).x} cy={proj(marker).y} r={22} fill="#2f6fde" stroke="#fff" strokeWidth={6} />}
    </svg>
  );
}

/** Small whole-India inset with the search position, shown in a corner of the results map. */
export function IndiaInset({ at }: { at: Point }) {
  return (
    <div className="h-36 w-36 rounded-lg border border-[var(--hc-border)] bg-[#dfe7ee] p-1 shadow-sm">
      <IndiaOverview marker={at} className="h-full w-full" />
    </div>
  );
}
