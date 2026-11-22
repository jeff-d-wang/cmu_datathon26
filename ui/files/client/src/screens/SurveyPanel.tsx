import { surveyFor, SURVEY_SOURCE } from '../domain/survey';

const NAMES: Record<string, string> = {
  c_section: 'C-section', cath_lab: 'Cath lab', ct: 'CT scan', dialysis: 'Dialysis', ecg: 'ECG (heart test)',
  emergency: 'Emergency care', fracture_care: 'Fracture care', icu: 'Intensive care (ICU)', inpatient: 'Hospital admission',
  lab: 'Lab tests', mri: 'MRI scan', operating_room: 'Operating theatre', ultrasound: 'Ultrasound', xray: 'X-ray',
};
const humanName = (n: string) => NAMES[n] ?? n.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export function SurveyPanel({ chips }: { chips: readonly string[] }) {
  const s = surveyFor(chips);
  if (!s || s.services.length === 0) return null;
  const pct = (x: number) => Math.round(x * 100);
  return (
    <section className="mt-3 border-t border-[var(--hc-border)] pt-3" aria-labelledby="survey-title">
      <h3 id="survey-title" className="text-[16px] font-bold">What similar emergency visits needed</h3>
      <p className="mt-1 text-[14px] text-[var(--hc-muted)]">
        From {s.nVisits.toLocaleString()} survey visits for &quot;{s.label}&quot; ({SURVEY_SOURCE}).
      </p>
      <ul className="mt-2 space-y-1 text-[15px]">
        {s.services.map((x) => (
          <li key={x.name}>
            {humanName(x.name)}:{' '}
            {x.ciLo !== null && x.ciHi !== null ? `likely ${pct(x.ciLo)}–${pct(x.ciHi)}%` : `about ${pct(x.share)}%`}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[14px] text-[var(--hc-muted)]">
        How often similar patients received this in an emergency department, not your chance of needing it. It does not change the order of places.
      </p>
    </section>
  );
}
