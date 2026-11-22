import type { ReactNode } from 'react';
import { useFlow } from '../flow/context';
import { useT } from '../i18n';
import { EmergencyBanner, LinkButton } from './ui';

/**
 * Desktop shell (1280x800 target): map/schematic on the left, task panel on the right.
 * Below 1024px (or at high zoom) it reflows to one column (WCAG 1.4.10).
 */
/** One panel width on every screen (consistent proportions). */
export const PANEL_WIDTH = 520;

export function Shell({ left, right, footer, bannerExtra }: { left: ReactNode; right: ReactNode; footer?: ReactNode; bannerExtra?: ReactNode }) {
  const { dispatch } = useFlow();
  const t = useT();
  return (
    // Fills the window exactly on desktop so only the task panel scrolls (one scrollbar, never two).
    <div className="flex min-h-dvh flex-col-reverse lg:grid lg:h-dvh lg:overflow-hidden" style={{ gridTemplateColumns: `minmax(0, 1fr) ${PANEL_WIDTH}px`, gridTemplateRows: "minmax(0, 1fr)" }}>
      <div className="h-[420px] overflow-hidden lg:h-full hc-no-print">{left}</div>
      <main id="hc-main" className="hc-scroll relative flex flex-col gap-4 border-l-[1.5px] border-[var(--hc-border)] bg-white px-7 pb-6 pt-6 lg:h-full lg:overflow-y-auto">
        <EmergencyBanner onOpen={() => dispatch({ type: 'emergency' })} extra={bannerExtra} />
        {right}
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-2 text-[15px] text-[var(--hc-muted)] hc-no-print">
          <span>{footer ?? t('nothing_saved')}</span>
          <LinkButton onClick={() => dispatch({ type: 'reset' })}>{t('start_over')}</LinkButton>
        </div>
      </main>
    </div>
  );
}
