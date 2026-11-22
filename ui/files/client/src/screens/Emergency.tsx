import { Phone } from 'lucide-react';
import { useFlow } from '../flow/context';
import { useT } from '../i18n';
import { LinkButton, ScreenTitle } from '../components/ui';

/** Emergency screen: reachable in one click from "Help right now" and from any red flag. No ranking, no list of "best" places. */
export function EmergencyScreen() {
  const { dispatch } = useFlow();
  const t = useT();
  return (
    <div className="hc-emergency min-h-screen bg-[var(--hc-em-bg)]">
      <main className="mx-auto flex max-w-[760px] flex-col gap-4 p-6">
        <div className="text-[16px] text-[var(--hc-em-text)]">{t('emergency_label')}</div>
        <ScreenTitle className="text-[40px] font-bold leading-tight text-[var(--hc-em-text)]">{t('emergency_title')}</ScreenTitle>
        <div className="grid grid-cols-2 gap-[14px]">
          {(['112', '108'] as const).map((n) => (
            <a key={n} href={`tel:${n}`} aria-label={`${t(n === '112' ? 'call_112' : 'call_108')}, ${t(n === '112' ? 'any_emergency' : 'ambulance')}`} className="flex min-h-[84px] items-center justify-center gap-3 rounded-[18px] bg-[var(--hc-em-btn)] text-white hover:brightness-110">
              <Phone className="h-8 w-8" aria-hidden />
              <span className="text-[36px] font-bold">{n}</span>
              <span className="text-[16px] font-medium">{t(n === '112' ? 'any_emergency' : 'ambulance')}</span>
            </a>
          ))}
        </div>
        <section className="rounded-2xl border-[1.5px] border-[var(--hc-em-border)] bg-white px-[22px] py-[18px] text-[18px]">
          <h2 className="mb-2 font-bold">{t('while_you_wait')}</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>{t('wait_1')}</li>
            <li>{t('wait_2')}</li>
            <li>{t('wait_3')}</li>
            <li>{t('wait_4')}</li>
          </ul>
        </section>
        <div className="flex items-center justify-between text-[15px]">
          <LinkButton onClick={() => dispatch({ type: 'back_from_emergency' })}>{t('not_emergency')}</LinkButton>
          <span className="text-[var(--hc-em-text)]">{t('cannot_diagnose')}</span>
        </div>
      </main>
    </div>
  );
}
