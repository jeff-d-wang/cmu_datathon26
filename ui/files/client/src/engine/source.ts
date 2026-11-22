import { isOwnWords, normalise, ownWordsText } from '../domain/symptoms';

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

/** Typed own-words text from chip ids (browser only). */
export const ownWordsOf = (ids: readonly string[], freeText: string): string => [freeText, ...ids.filter(isOwnWords).map(ownWordsText)].join(' ');
