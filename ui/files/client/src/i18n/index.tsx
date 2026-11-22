import { createContext, useContext, type ReactNode } from 'react';
import { en, type StringKey } from './en';

/** English only for now. Add a table here (and a switch in the UI) to bring back other languages. */
export type Lang = 'en';

const tables: Record<Lang, Partial<Record<StringKey, string>>> = { en };

export type T = (key: StringKey, vars?: Record<string, string | number>) => string;

export function makeT(lang: Lang): T {
  return (key, vars) => {
    let s: string = tables[lang][key] ?? en[key];
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
    return s;
  };
}

const Ctx = createContext<T>(makeT('en'));
export function I18nProvider({ lang, children }: { lang: Lang; children: ReactNode }) {
  return <Ctx.Provider value={makeT(lang)}>{children}</Ctx.Provider>;
}
export const useT = () => useContext(Ctx);

/** Display label for a symptom id, including symptoms typed in the user's own words ("own:…"). */
export function symptomLabel(t: T, id: string): string {
  if (id.startsWith('own:')) return id.slice(4);
  return t(`chip_${id}` as StringKey);
}
