// Straight-line (haversine) distances. Never presented as travel time.
export const RADII_KM = [25, 50, 100, 250] as const;
export const FETCH_RADIUS_KM = 250;
const GRID_DEG = 0.5;

export interface Point {
  lat: number;
  lon: number;
}

export interface BBox {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export function haversineKm(a: Point, b: Point): number {
  const r = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Bounding box for a search radius, rounded OUTWARD to a 0.5-degree grid.
 * Privacy: only this coarse box is sent to the warehouse (and appears in query history),
 * never the user's exact point.
 */
export function coarseBBox(center: Point, radiusKm: number): BBox {
  const dLat = radiusKm / 111;
  const dLon = radiusKm / (111 * Math.max(0.2, Math.cos((center.lat * Math.PI) / 180)));
  const down = (v: number) => Math.floor(v / GRID_DEG) * GRID_DEG;
  const up = (v: number) => Math.ceil(v / GRID_DEG) * GRID_DEG;
  return {
    minLat: down(center.lat - dLat),
    maxLat: up(center.lat + dLat),
    minLon: down(center.lon - dLon),
    maxLon: up(center.lon + dLon),
  };
}

/** Smallest radius in 25 -> 50 -> 100 -> 250 that has at least `want` places; falls back to the largest. */
export function chooseRadius(distancesKm: number[], want = 5): { radiusKm: number; widened: boolean } {
  for (const r of RADII_KM) {
    if (distancesKm.filter((d) => d <= r).length >= want) return { radiusKm: r, widened: r !== RADII_KM[0] };
  }
  return { radiusKm: RADII_KM[RADII_KM.length - 1], widened: true };
}

export const KM_TO_MI = 0.621371;
/** Whole-number distance in the user's unit; under 1 unit reads "under 1 km". */
export function formatDistance(km: number, unit: 'km' | 'mi'): string {
  const v = unit === 'mi' ? km * KM_TO_MI : km;
  return v < 1 ? `under 1 ${unit}` : `${Math.round(v)} ${unit}`;
}
