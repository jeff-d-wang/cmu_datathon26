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
  const lower = text.toLowerCase();
  if (query.includes(' ') && lower.includes(query)) return 0;
  const words = lower.split(/[\s,]+/).filter(Boolean);
  let best = Infinity;
  for (const w of words) {
    if (w.startsWith(query)) return 0;
    best = Math.min(best, lev(query, w.slice(0, Math.max(query.length, 3))));
  }
  return best;
}

export function searchPlaces(places: readonly Place[], raw: string, max = 8): Place[] {
  const q = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  if (q.length < 2) return [];
  if (/^\d+$/.test(q)) return places.filter((p) => p.kind === 'pin' && p.code.startsWith(q)).slice(0, max);
  const tokens = q.split(' ');
  const tolOf = (tk: string) => (tk.length <= 4 ? 1 : 2);
  const scored = (p: Place) => {
    const hay = [p.district, p.towns].filter(Boolean);
    const best = (s: string) => Math.min(...hay.map((h) => bestDistance(s, h)));
    // A full-substring hit is exact; otherwise every typed word must match some word of the place (worst token decides).
    if (tokens.length > 1 && best(q) === 0) return 0;
    return tokens.every((tk) => best(tk) <= tolOf(tk)) ? Math.max(...tokens.map(best)) : Infinity;
  };
  return places
    .map((p) => ({ p, d: scored(p) - (p.kind === 'district' ? 0.5 : 0) }))
    .filter((x) => x.d !== Infinity)
    .sort((a, b) => a.d - b.d)
    .slice(0, max)
    .map((x) => x.p);
}

const title = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
/** Short label: "110001 · New Delhi" or "Karimnagar district". Post-office names are shown separately (placeTowns). */
export function placeLabel(p: Place): string {
  if (p.kind === 'gps') return p.district;
  return p.kind === 'pin' ? `${p.code} · ${title(p.district)}` : `${title(p.district)} district`;
}
/** Post-office names for a PIN place (muted second line), or '' when there are none. */
export const placeTowns = (p: Place): string => (p.kind === 'pin' && p.towns && p.towns.toLowerCase() !== p.district.toLowerCase() ? p.towns : '');
/** Shortest name for headings: "New Delhi". */
export const placeShort = (p: Place): string => (p.kind === 'gps' ? p.district : title(p.district));
