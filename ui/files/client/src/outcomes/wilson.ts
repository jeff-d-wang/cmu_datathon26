/**
 * 95% Wilson score interval for a binomial proportion x/n.
 * A real statistical interval (it may be labelled as one). z defaults to 1.959964 (two-sided 95%).
 */
export function wilson(x: number, n: number, z = 1.959964): { p: number; lo: number; hi: number } {
  if (!Number.isFinite(x) || !Number.isFinite(n) || n <= 0 || x < 0 || x > n) throw new Error(`wilson: invalid x=${x}, n=${n}`);
  const p = x / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { p, lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}
