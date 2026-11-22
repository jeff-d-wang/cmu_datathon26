import type { Ranked } from './ranking';

/** Split ranked places at the radius: inside keeps score order, outside is sorted by distance. Nothing is dropped. */
export function splitByRadius(ranked: Ranked[], radiusKm: number): { inside: Ranked[]; outside: Ranked[] } {
  return {
    inside: ranked.filter((r) => r.km <= radiusKm),
    outside: ranked.filter((r) => r.km > radiusKm).sort((a, b) => a.km - b.km),
  };
}
