import { useState } from 'react';
import { formatDistance } from '../domain/geo';
import { serviceName } from '../domain/services';
import { useT } from '../i18n';
import type { StringKey } from '../i18n/en';
import type { Ranked, Tier } from '../domain/ranking';
import type { DataWarning } from '../domain/warnings';
import { TriangleAlert } from 'lucide-react';
import { StatusTag, type Status } from '../components/ui';

const TIER_STATUS: Record<Tier, Status> = { A: 'ok', B: 'info', C: 'unknown', D: 'unknown' };

export function TierTag({ tier }: { tier: Tier }) {
  const t = useT();
  return <StatusTag status={TIER_STATUS[tier]}>{t(`tier_${tier}` as StringKey)}</StatusTag>;
}

/** At most two warnings per card: one row each (icon, text, "Why?"), expandable to the quoted source text. */
export function WarningList({ warnings }: { warnings: DataWarning[] }) {
  const t = useT();
  const [open, setOpen] = useState<string | null>(null);
  if (warnings.length === 0) return null;
  return (
    <ul className="divide-y divide-[var(--hc-warn-border)] overflow-hidden rounded-xl border-[1.5px] border-[var(--hc-warn-border)] bg-[var(--hc-warn-bg)]">
      {warnings.map((w) => (
        <li key={w.id} className="px-3 py-2 text-[15px] text-[var(--hc-warn-text)]">
          <div className="flex items-start gap-2">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span className="flex-1 font-semibold">{t(`w_${w.id}` as StringKey)}</span>
            <button type="button" className="shrink-0 rounded-md px-1 text-[15px] font-semibold underline underline-offset-2" aria-expanded={open === w.id} onClick={() => setOpen(open === w.id ? null : w.id)}>
              {open === w.id ? t('hide_why') : t('show_why')}
            </button>
          </div>
          {open === w.id && <p className="mt-1 pl-6 text-[15px]">{w.why}</p>}
        </li>
      ))}
    </ul>
  );
}

/** Plain-language reasons, in the same order the ranking uses them. No percentages, no weights. */
export function WhyList({ r, unit }: { r: Ranked; unit: 'km' | 'mi' }) {
  const t = useT();
  const best = r.matched[0];
  const tierText =
    r.tier === 'A' || r.tier === 'B'
      ? t(r.tier === 'A' ? 'why_A' : 'why_B', { service: best ? serviceName(best.service) : '' })
      : t(r.tier === 'C' ? 'why_C' : 'why_D');
  const items = [
    tierText,
    t(r.emergency === 'backed' ? 'em_backed' : r.emergency === 'claimed' ? 'em_claimed' : 'em_none'),
    t('dist_line', { d: formatDistance(r.km, unit) }),
  ];
  if (r.conditionHits.length > 0) items.push(t('cond_line', { list: r.conditionHits.map((c) => t(`b_${c}` as StringKey)).join(', ') }));
  return (
    <ul className="list-disc space-y-0.5 pl-5 text-[16px]">
      {items.map((x) => (
        <li key={x}>{x}</li>
      ))}
    </ul>
  );
}

export function HowOrdered({ mode }: { mode: 'urgent' | 'planned' }) {
  const t = useT();
  return (
    <details className="text-[16px]">
      <summary className="min-h-8 cursor-pointer font-semibold text-[var(--hc-primary)] underline">{t('how_ordered')}</summary>
      <p className="mt-1 text-[var(--hc-text-2)]">{t(mode === 'urgent' ? 'how_ordered_urgent' : 'how_ordered_planned')}</p>
    </details>
  );
}


/** Confidence as three bars plus the word (never colour alone). */
export function ConfidenceBars({ level, small }: { level: 'High' | 'Medium' | 'Low'; small?: boolean }) {
  const n = level === 'High' ? 3 : level === 'Medium' ? 2 : 1;
  return (
    <span className={`inline-flex items-center gap-1.5 font-medium ${small ? 'text-[13px]' : 'text-[14px]'} text-[var(--hc-text)]`}>
      <span aria-hidden className="inline-flex items-end gap-[2px]">
        {[0, 1, 2].map((i) => (
          <span key={i} className="w-[4px] rounded-[1px]" style={{ height: 6 + i * 4, background: i < n ? 'var(--hc-primary)' : 'var(--hc-border)' }} />
        ))}
      </span>
      {level} confidence
    </span>
  );
}

/**
 * Match score as a number plus a 0-100 track: the shaded band is the score range
 * (what is listed .. what may also exist), the tick is the score. Not a statistical interval.
 */
export function ScoreMeter({ score, lo, hi, confidence, compact }: { score: number; lo: number; hi: number; confidence: 'High' | 'Medium' | 'Low'; compact?: boolean }) {
  const s = Math.round(score);
  const l = Math.round(lo);
  const h = Math.round(hi);
  const label = `Match score ${s} out of 100${l !== h ? `, score range ${l} to ${h}` : ''}, ${confidence.toLowerCase()} confidence`;
  const track = (
    <span aria-hidden className={`relative block rounded-full bg-[var(--hc-bg)] ring-1 ring-inset ring-[var(--hc-border)] ${compact ? 'h-1.5 w-16' : 'h-2.5 w-full'}`}>
      <span className="absolute inset-y-0 rounded-full" style={{ left: `${l}%`, width: `${Math.max(h - l, 1.5)}%`, background: 'color-mix(in srgb, var(--hc-primary) 30%, transparent)' }} />
      <span className={`absolute rounded-full bg-[var(--hc-primary-dark)] ${compact ? '-top-[3px] h-3 w-[3px]' : '-top-[4px] h-[18px] w-[3px]'}`} style={{ left: `calc(${s}% - 1.5px)` }} />
    </span>
  );
  if (compact) {
    return (
      <span role="img" aria-label={label} className="inline-flex items-center gap-2">
        <span aria-hidden className="text-[15px] font-bold tabular-nums text-[var(--hc-primary-dark)]">{s}</span>
        {track}
      </span>
    );
  }
  return (
    <div role="img" aria-label={label} className="flex items-center gap-4">
      <div aria-hidden className="shrink-0 leading-none">
        <span className="text-[34px] font-bold tabular-nums tracking-tight text-[var(--hc-primary-dark)]">{s}</span>
        <span className="text-[15px] font-medium text-[var(--hc-muted)]">/100</span>
        <span className="mt-1 block text-[13px] font-medium text-[var(--hc-muted)]">Match score</span>
      </div>
      <div aria-hidden className="min-w-0 flex-1 pt-1">
        {track}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[13px] text-[var(--hc-muted)]">
          <span className="tabular-nums">{l !== h ? `Range ${l}–${h}` : 'Exact: nothing unknown'}</span>
          <ConfidenceBars level={confidence} small />
        </div>
      </div>
    </div>
  );
}
