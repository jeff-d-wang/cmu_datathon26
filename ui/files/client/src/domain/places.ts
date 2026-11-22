// Spelling-tolerant place search, run entirely in the browser (typed text never leaves the device).
export interface Place {
  kind: string;
  code: string;
  district: string;
  state: string;
  towns: string;
  lat: number;
  lon: number;
}

function lev(a: string, b: string): number {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return d[b.length];
}

function bestDistance(query: string, text: string): number {
  const words = text.toLowerCase().split(/[\s,]+/).filter(Boolean);
  let best = Infinity;
  for (const w of words) {
    if (w.startsWith(query)) return 0;
    best = Math.min(best, lev(query, w.slice(0, Math.max(query.length, 3))));
  }
  return best;
}

export function searchPlaces(places: readonly Place[], raw: string, max = 8): Place[] {
  const q = raw.trim().toLowerCase();
  if (q.length < 2) return [];
  if (/^\d+$/.test(q)) return places.filter((p) => p.kind === 'pin' && p.code.startsWith(q)).slice(0, max);
  const tol = q.length <= 4 ? 1 : 2;
  return places
    .map((p) => ({ p, d: Math.min(bestDistance(q, p.district), p.towns ? bestDistance(q, p.towns) : Infinity) - (p.kind === 'district' ? 0.5 : 0) }))
    .filter((x) => x.d <= tol)
    .sort((a, b) => a.d - b.d)
    .slice(0, max)
    .map((x) => x.p);
}

export function placeLabel(p: Place): string {
  if (p.kind === 'gps') return p.district;
  const title = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  return p.kind === 'pin' ? `${p.code} · ${p.towns || title(p.district)} (${title(p.district)})` : `${title(p.district)} district`;
}
