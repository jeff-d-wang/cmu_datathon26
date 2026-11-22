import type { SafetyChecks } from '../domain/redflags';
import type { Conditions, Mode } from '../domain/types';
import { isServiceKey, type ServiceKey } from '../domain/services';
import type { Place } from '../domain/places';
import type { Lang } from '../i18n';

export type Screen = 'place' | 'intent' | 'emergency' | 'who' | 'symptoms' | 'results' | 'detail' | 'howscore';
export type DistanceUnit = 'km' | 'mi';
export type Intent = 'now' | 'soon' | 'surgery';
export type Ownership = 'any' | 'private' | 'public';

/** All state lives in memory only. Nothing is written to cookies or localStorage. */
export interface FlowState {
  screen: Screen;
  returnTo: Screen | null;
  lang: Lang;
  intent: Intent | null;
  forSelf: boolean | null;
  ageRaw: string;
  sex: 'woman' | 'man' | 'other' | null;
  conditions: Conditions;
  freeText: string;
  chips: string[];
  safety: SafetyChecks;
  state: string;
  place: Place | null;
  ownership: Ownership;
  /** Search radius in km chosen on the slider; null = automatic (25 -> 50 -> 100 -> 250). */
  radiusKm: number | null;
  unit: DistanceUnit;
  serviceFilter: ServiceKey | 'any';
  showN: 5 | 10 | 20;
  selectedId: string | null;
}

export const initialState = (lang: Lang = 'en'): FlowState => ({
  screen: 'place',
  returnTo: null,
  lang,
  intent: null,
  forSelf: null,
  ageRaw: '',
  sex: null,
  conditions: { pregnant: false, kidney: false, stroke: false, diabetes: false },
  freeText: '',
  chips: [],
  safety: { painAtRestOr15Min: false, sweatingNauseaFaint: false, breathlessAtRest: false, jawArmBackPain: false },
  state: '',
  place: null,
  ownership: 'any',
  radiusKm: null,
  unit: 'km',
  serviceFilter: 'any',
  showN: 5,
  selectedId: null,
});

export const modeFor = (intent: Intent | null): Mode => (intent === 'surgery' ? 'planned' : 'urgent');

export type Action =
  | { type: 'go'; screen: Screen }
  | { type: 'emergency' }
  | { type: 'back_from_emergency' }
  | { type: 'set'; patch: Partial<FlowState> }
  | { type: 'toggle_chip'; id: string }
  | { type: 'reset' };

export function reducer(s: FlowState, a: Action): FlowState {
  switch (a.type) {
    case 'go':
      return { ...s, screen: a.screen };
    case 'emergency':
      return { ...s, returnTo: s.screen === 'emergency' ? s.returnTo : s.screen, screen: 'emergency' };
    case 'back_from_emergency':
      return { ...s, screen: s.returnTo && s.returnTo !== 'emergency' ? s.returnTo : 'place', returnTo: null, intent: s.intent === 'now' ? null : s.intent };
    case 'set':
      return { ...s, ...a.patch };
    case 'toggle_chip':
      return { ...s, chips: s.chips.includes(a.id) ? s.chips.filter((c) => c !== a.id) : [...s.chips, a.id] };
    case 'reset':
      // "Start over (new person)": clears everything except the chosen UI language.
      return initialState(s.lang);
  }
}

/**
 * Share link: only non-sensitive state, in the URL #fragment (never sent to the server).
 * Symptoms, age, sex and conditions are never included.
 */
export function shareFragment(s: FlowState): string {
  const p = new URLSearchParams();
  if (s.place) {
    // A device location is shared only at ~10 km precision (1 decimal); a chosen district/PIN centre at 2 decimals.
    const dp = s.place.kind === 'gps' ? 1 : 2;
    p.set('lat', s.place.lat.toFixed(dp));
    p.set('lon', s.place.lon.toFixed(dp));
    p.set('place', s.place.kind === 'pin' ? s.place.code : s.place.district);
    p.set('st', s.place.state);
  }
  if (s.intent) p.set('need', s.intent);
  if (s.serviceFilter !== 'any') p.set('svc', s.serviceFilter);
  if (s.ownership !== 'any') p.set('own', s.ownership);
  p.set('n', String(s.showN));
  return `#${p.toString()}`;
}

export function fromFragment(hash: string, base: FlowState): FlowState {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const lat = Number(p.get('lat'));
  const lon = Number(p.get('lon'));
  const next: FlowState = { ...base };
  if (!p.get('lat') || !Number.isFinite(lat) || !Number.isFinite(lon)) return next;
  const need = p.get('need');
  const own = p.get('own');
  const n = Number(p.get('n'));
  const svc = p.get('svc');
  return {
    ...next,
    screen: 'results',
    intent: need === 'surgery' ? 'surgery' : 'soon',
    place: { kind: 'shared', code: p.get('place') ?? '', district: p.get('place') ?? '', state: p.get('st') ?? '', towns: '', lat, lon },
    state: p.get('st') ?? '',
    ownership: own === 'private' || own === 'public' ? own : 'any',
    showN: n === 10 || n === 20 ? n : 5,
    serviceFilter: svc && isServiceKey(svc) ? svc : 'any',
  };
}
