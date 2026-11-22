import fixture from './fixture.notebook.json';
import { isOwnWords, normalise, ownWordsText } from '../domain/symptoms';
import type { EngineEntry } from './contract';

const ENTRIES = fixture.entries as unknown as EngineEntry[];
export const FIXTURE_PINS = ['302001', '411001', '800001'];
const FALLBACK_QUERY = 'uneasy since yesterday';

/** Our symptom ids (or own-words patterns) -> the engine's demo queries. First match wins. Extend here. */
const QUERY_MAP: { ids?: string[]; words?: RegExp; query: string }[] = [
  { ids: ['chest_pressure'], query: 'chest pain' },
  { ids: ['stroke_signs'], query: 'stroke symptoms, face drooping' },
  { ids: ['kidney'], query: 'need dialysis for kidney failure' },
  { words: /back pain/, query: 'low back pain' },
  { words: /swallow|poison|overdose|pills/, query: 'child swallowed too many pills' },
];

export const mapQuery = (ids: readonly string[], ownWords: string): string =>
  QUERY_MAP.find((m) => m.ids?.some((i) => ids.includes(i)) || m.words?.test(normalise(ownWords)))?.query ?? FALLBACK_QUERY;

/** Local stand-in for find_facilities; swap this one function for a live source later. Null = no entry for the PIN. */
export function getEngineResult(querySymptomIds: readonly string[], ownWords: string, pin: string): EngineEntry | null {
  const q = mapQuery(querySymptomIds, ownWords);
  return ENTRIES.find((e) => e.pin === pin && e.query === q) ?? null;
}

/** Typed own-words text from chip ids (browser only). */
export const ownWordsOf = (ids: readonly string[], freeText: string): string => [freeText, ...ids.filter(isOwnWords).map(ownWordsText)].join(' ');
export { ENTRIES as FIXTURE_ENTRIES };
