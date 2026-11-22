const NULLISH = new Set(['', '[]', 'null', 'none', 'nan', 'n/a', 'undefined']);

/** False for null, undefined, NaN, blank text, '[]' and the strings null/None/nan/n/a (any case). */
export const isPresent = (v: unknown): boolean => {
  if (v === null || v === undefined) return false;
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v === 'string') return !NULLISH.has(v.trim().toLowerCase());
  return true;
};

/** Trimmed text, or null when the value is not presentable. */
export const clean = (v: unknown): string | null => (isPresent(v) ? String(v).trim() : null);
