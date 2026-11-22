import { expect, test } from 'vitest';
import { splitByRadius } from './radius';
import type { Ranked } from './ranking';

const r = (km: number) => ({ km }) as Ranked;

test('splits at the radius; inside keeps order, outside sorted by distance, nothing dropped', () => {
  const { inside, outside } = splitByRadius([r(30), r(5), r(80), r(10), r(60)], 25);
  expect(inside.map((x) => x.km)).toEqual([5, 10]);
  expect(outside.map((x) => x.km)).toEqual([30, 60, 80]);
});
