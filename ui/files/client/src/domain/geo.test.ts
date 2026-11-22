import { describe, expect, test } from 'vitest';
import { formatDistance } from './geo';

describe('formatDistance', () => {
  test('km rounds to whole numbers', () => {
    expect(formatDistance(12.4, 'km')).toBe('12 km');
    expect(formatDistance(250, 'km')).toBe('250 km');
  });
  test('mi converts', () => {
    expect(formatDistance(12, 'mi')).toBe('7 mi');
    expect(formatDistance(250, 'mi')).toBe('155 mi');
  });
  test('under 1', () => {
    expect(formatDistance(0.4, 'km')).toBe('under 1 km');
    expect(formatDistance(1.2, 'mi')).toBe('under 1 mi');
  });
});
