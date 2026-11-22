// Test-only: notebook fixture used by parity tests. Not imported by the app.
import fixture from './fixture.notebook.json';
import type { EngineEntry } from './contract';
import { mapQuery } from './source';

const ENTRIES = fixture.entries as unknown as EngineEntry[];
export const FIXTURE_PINS = ['302001', '411001', '800001'];

/** Local stand-in for find_facilities; swap this one function for a live source later. Null = no entry for the PIN. */
export function getEngineResult(querySymptomIds: readonly string[], ownWords: string, pin: string): EngineEntry | null {
  const q = mapQuery(querySymptomIds, ownWords);
  return ENTRIES.find((e) => e.pin === pin && e.query === q) ?? null;
}

export { ENTRIES as FIXTURE_ENTRIES };
