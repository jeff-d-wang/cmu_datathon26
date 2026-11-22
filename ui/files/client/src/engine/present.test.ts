import { describe, expect, it } from 'vitest';
import { clean, isPresent } from './present';

describe('isPresent / clean', () => {
  it('hides null-ish values', () => {
    for (const v of [null, undefined, NaN, '', '  ', '[]', 'null', ' None ', 'NaN', 'N/A', 'n/a']) {
      expect(isPresent(v)).toBe(false);
      expect(clean(v)).toBeNull();
    }
  });
  it('keeps real values', () => {
    expect(isPresent(0)).toBe(true);
    expect(clean('  Delhi ')).toBe('Delhi');
    expect(clean(12)).toBe('12');
  });
});
