import { ClipboardList } from 'lucide-react';
import { useT } from '../i18n';
import type { StringKey } from '../i18n/en';
import { CARE_LEVEL_LABEL, type LayerAAssessment, type SeverityTier } from '../domain/severity';
import { SurveyPanel } from './SurveyPanel';
import { StatusTag, type Status } from '../components/ui';

const TIER_STATUS: Record<SeverityTier, Status> = { EMERGENCY_NOW: 'bad', URGENT: 'warn', ROUTINE: 'info' };

export function LayerAPanel({ a, tier, chips }: { a: LayerAAssessment; tier: SeverityTier; chips?: readonly string[] }) {
  const t = useT();
  return (
    <section className="rounded-[var(--hc-r-control)] border-[1.5px] border-[var(--hc-border)] bg-white px-4 py-3" aria-labelledby="next-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="next-title" className="flex items-center gap-2 text-[17px] font-bold"><ClipboardList className="h-5 w-5 text-[var(--hc-primary)]" aria-hidden />{t('next_title')}</h2>
        <StatusTag status={TIER_STATUS[tier]}>{t(`tier_${tier}` as StringKey)}</StatusTag>
      </div>
      {a.treatments.length > 0 && (
        <ul className="mt-2 space-y-1.5 text-[16px]">
          {a.treatments.map((x) => (
            <li key={x.symptomId}>
              {x.text}
              <span className="block text-[15px]">This can be a warning sign of {x.warningSign}.</span>
              <span className="block text-[14px] text-[var(--hc-muted)]">{t('based_on', { name: x.guideline.name, year: x.guideline.year, verify: x.guideline.verify })}</span>
            </li>
          ))}
        </ul>
      )}
      {tier === 'URGENT' && (
        <div className="mt-2 text-[15px]">
          <p className="font-semibold">Go to an emergency department if it:</p>
          <ul className="list-disc pl-5">
            <li>happens at rest</li>
            <li>lasts over 15 minutes</li>
            <li>comes with sweating or breathlessness</li>
          </ul>
        </div>
      )}
      <p className="mt-2 text-[15px]"><strong>{t('care_looking_for')}</strong> {a.careLevels.map(CARE_LEVEL_LABEL).join(', ')}</p>
      <p className="mt-1 text-[14px] text-[var(--hc-muted)]">{t('next_draft')}</p>
      <p className="mt-1 text-[14px] font-semibold text-[var(--hc-text-2)]">Not medical advice. This tool cannot diagnose.</p>
      {chips && <SurveyPanel chips={chips} />}
    </section>
  );
}
