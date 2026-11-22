import { describe, expect, it } from 'vitest';
import { CURATED, requestById, searchRequests } from './requests';
import { isServiceKey } from './services';

describe('requests', () => {
  it('finds requests by typed words', () => {
    expect(searchRequests('c-sec')[0].id).toBe('emergencyCSection');
    expect(searchRequests('mri')[0].id).toBe('mriScanner');
    expect(searchRequests('dial').map((r) => r.id)).toContain('dialysis');
    expect(searchRequests('burn')[0].id).toBe('burnCare');
    expect(searchRequests('m')).toEqual([]);
  });
  it('curated requests use valid keys, one critical need and a note', () => {
    for (const r of CURATED) {
      expect(r.needs.every((x) => isServiceKey(x.service))).toBe(true);
      expect(r.needs.filter((x) => x.critical)).toHaveLength(1);
      expect(r.note).toBeTruthy();
    }
  });
  it('catalog services become single critical-need requests', () => {
    expect(requestById('dialysis')?.needs).toEqual([{ service: 'dialysis', weight: 1, critical: true }]);
  });
});
