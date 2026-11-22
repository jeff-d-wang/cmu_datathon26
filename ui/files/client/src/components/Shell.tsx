import { useEffect, useState, type ReactNode } from 'react';
import { useFlow } from '../flow/context';
import { useT } from '../i18n';
import { EmergencyBanner, LinkButton } from './ui';

/**
 * Desktop shell (1280x800 target): map/schematic on the left, task panel on the right.
 * Below 1024px (or at high zoom) it reflows to one column (WCAG 1.4.10).
 */
const DESKTOP = '(min-width: 1024px)';
/** True at >= 1024px. Used so only one map instance is mounted (side panel on desktop, strip on mobile results). */
export function useDesktop(): boolean {
  const [on, setOn] = useState(() => window.matchMedia(DESKTOP).matches);
  useEffect(() => {
    const m = window.matchMedia(DESKTOP);
    const f = () => setOn(m.matches);
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, []);
  return on;
}

/** One panel width on every screen (consistent proportions). */
export const PANEL_WIDTH = 520;

export function Shell({ left, right, footer, bannerExtra, bannerText }: { left: ReactNode; right: ReactNode; footer?: ReactNode; bannerExtra?: ReactNode; bannerText?: string }) {
  const { dispatch } = useFlow();
  const t = useT();
  const desktop = useDesktop();
  return (
    // Fills the window exactly on desktop so only the task panel scrolls (one scrollbar, never two).
    <div className="flex min-h-dvh flex-col-reverse lg:grid lg:h-dvh lg:overflow-hidden" style={{ gridTemplateColumns: `minmax(0, 1fr) ${PANEL_WIDTH}px`, gridTemplateRows: "minmax(0, 1fr)" }}>
      {desktop && <div className="h-full overflow-hidden hc-no-print">{left}</div>}
      <main id="hc-main" className="hc-scroll relative flex flex-col gap-4 border-l-[1.5px] border-[var(--hc-border)] bg-white px-7 pb-6 pt-6 lg:h-full lg:overflow-y-auto">
        <EmergencyBanner onOpen={() => dispatch({ type: 'emergency' })} extra={bannerExtra} replaceText={bannerText} />
        {right}
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-2 text-[15px] text-[var(--hc-muted)] hc-no-print">
          <span>{footer ?? t('nothing_saved')}</span>
          <LinkButton onClick={() => dispatch({ type: 'reset' })}>{t('start_over')}</LinkButton>
        </div>
      </main>
    </div>
  );
}
