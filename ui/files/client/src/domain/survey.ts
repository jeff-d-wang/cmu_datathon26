import data from '../survey/complaint_profiles.json';

type Svc = { share: number; ci_lo?: number | null; ci_hi?: number | null };
type Profile = { label: string; n_visits: number; services: Record<string, Svc> };
const profiles = data.profiles as unknown as Record<string, Profile>;

/** Symptom chip id -> NHAMCS reason-for-visit code. */
export const CHIP_TO_COMPLAINT: Record<string, number> = {
  chest_pressure: 1050,
  cough: 1440,
  breathless: 1415,
  dizziness: 1225,
  unusual_tiredness: 1020,
  racing_heartbeat: 1260,
  fainting: 1030,
  high_bp: 2510,
};

/** Short citation, from the survey file's source (name and year only). */
export const SURVEY_SOURCE: string = `${data.source.split(' (')[0]} emergency-visit survey`;

export type SurveyService = { name: string; share: number; ciLo: number | null; ciHi: number | null };
export type SurveyResult = { code: number; label: string; nVisits: number; services: SurveyService[] };

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function surveyFor(chipIds: readonly string[]): SurveyResult | null {
  for (const id of chipIds) {
    const code = CHIP_TO_COMPLAINT[id];
    const p = code === undefined ? undefined : profiles[String(code)];
    if (!p) continue;
    const services = Object.entries(p.services)
      .map(([name, s]) => ({ name, share: num(s.share) ?? 0, ciLo: num(s.ci_lo), ciHi: num(s.ci_hi) }))
      .filter((s) => s.share >= 0.05)
      .sort((a, b) => b.share - a.share)
      .slice(0, 6);
    return { code, label: p.label, nVisits: p.n_visits, services };
  }
  return null;
}
