import { formatDistance } from './geo';
import type { Ranked } from './ranking';

/** Lowest score a place beyond the radius needs for a letter: close to the best places inside (5 points below the
 * top in-radius score), capped at 80; 70 when nothing inside matches. The score already includes the distance penalty. */
export function outsideBar(inside: readonly Ranked[]): number {
  if (inside.length === 0) return 70;
  const top = Math.max(...inside.map((r) => r.score.score));
  return Math.min(80, top - 5);
}

/** Why a place beyond the radius is still worth showing, in plain words. */
export function outsideReason(r: Ranked, inside: readonly Ranked[], radiusKm: number, unit: 'km' | 'mi'): string {
  const score = Math.round(r.score.score);
  const beyond = formatDistance(Math.max(0, r.km - radiusKm), unit);
  const beats = inside.filter((x) => x.score.score < r.score.score).length;
  const top = inside.length ? Math.round(Math.max(...inside.map((x) => x.score.score))) : null;
  const compare = inside.length === 0
    ? 'and nothing inside your radius matches this case'
    : beats === inside.length
      ? `higher than every place inside your radius (best inside: ${top})`
      : beats > 0
        ? `higher than ${beats} of the ${inside.length} places inside your radius`
        : `close to the best place inside your radius (${top})`;
  return `Even though it is ${beyond} beyond your radius, it scores ${score}, ${compare}, after the points it loses for distance. ${r.score.why.replace(/,\s*[\d.,]+\s*(km|mi) away\.?\s*$/, '.')}`;
}
