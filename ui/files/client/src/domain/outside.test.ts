import { describe, expect, it } from 'vitest';
import { outsideBar, outsideReason } from './outside';
import type { Ranked } from './ranking';

const r = (score: number, km: number, why = 'Lists heart specialist (cardiology).'): Ranked =>
  ({ km, score: { score, why } }) as unknown as Ranked;

describe('outsideBar', () => {
  it('is 70 when nothing inside matches', () => expect(outsideBar([])).toBe(70));
  it('is 5 below the best inside score', () => expect(outsideBar([r(60, 5), r(72, 8)])).toBe(67));
  it('is capped at 80', () => expect(outsideBar([r(95, 5)])).toBe(80));
});

describe('outsideReason', () => {
  it('says how far beyond and how it compares', () => {
    const text = outsideReason(r(84, 31), [r(90, 5), r(80, 9), r(70, 12)], 25, 'km');
    expect(text).toContain('6 km beyond your radius');
    expect(text).toContain('scores 84');
    expect(text).toContain('higher than 2 of the 3 places inside your radius');
    expect(text).toContain('Lists heart specialist');
  });
  it('drops the distance already given at the end of the why sentence', () => {
    const text = outsideReason(r(90, 12, 'Lists ICU, emergency care with support, 12 km away.'), [r(80, 5)], 10, 'km');
    expect(text).toMatch(/emergency care with support\.$/);
  });
  it('handles an empty radius', () => {
    expect(outsideReason(r(75, 40), [], 25, 'km')).toContain('nothing inside your radius matches');
  });
  it('handles beating every place inside', () => {
    expect(outsideReason(r(91, 30), [r(85, 5)], 25, 'km')).toContain('higher than every place inside your radius (best inside: 85)');
  });
});
