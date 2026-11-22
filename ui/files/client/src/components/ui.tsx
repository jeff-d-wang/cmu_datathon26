import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Check, HeartPulse, Info, TriangleAlert, CircleCheck, CircleHelp, CircleX, Phone } from 'lucide-react';
import { useT } from '../i18n';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

/**
 * Persistent emergency banner (every screen). A labelled region, not a live alert, so it is not
 * re-announced on every screen change. Optional `extra` puts urgent advice inside it (one red box, not two).
 */
export function EmergencyBanner({ onOpen, extra, replaceText }: { onOpen: () => void; extra?: ReactNode; replaceText?: string }) {
  const t = useT();
  const [before, rest] = t('emergency_banner').split('{112}');
  const [mid, after] = (rest ?? '').split('{108}');
  return (
    <aside aria-label={t('emergency_numbers')} className="rounded-[var(--hc-r-control)] border-[1.5px] border-[var(--hc-em-border)] bg-[var(--hc-em-bg)] px-3 py-2 text-[16px] text-[var(--hc-em-text)] hc-no-print">
      <div className="flex items-start gap-2">
        <TriangleAlert className="mt-1 h-4 w-4 shrink-0" aria-hidden />
        <p className="flex-1">
          {replaceText ? <strong className="font-extrabold">{replaceText.split(/(112|108)/).map((part, i) => (part === '112' || part === '108' ? <a key={i} href={`tel:${part}`} className="underline">{part}</a> : part))}</strong> : <>
          {before}
          <a href="tel:112" className="font-bold underline">112</a>
          {mid}
          <a href="tel:108" className="font-bold underline">108</a>
          {after}</>}
        </p>
        <button type="button" onClick={onOpen} aria-label={t('open_emergency')} className="min-h-11 shrink-0 rounded-[var(--hc-r-inner)] px-2 text-[15px] font-semibold underline">
          {t('what_to_do')} →
        </button>
      </div>
      {extra && <p className="mt-1 border-t border-[var(--hc-em-border)] pt-1 font-semibold">{extra}</p>}
    </aside>
  );
}

export function StepHeader({ step }: { step: number }) {
  const t = useT();
  return (
    <div className="flex items-center gap-3 text-[15px] text-[var(--hc-muted)]">
      <span>{t('step_of', { n: step })}</span>
      <div className="h-1.5 flex-1 rounded-full bg-[#dce3df]" aria-hidden>
        <div className="h-1.5 rounded-full bg-[var(--hc-primary)]" style={{ width: `${step * 25}%` }} />
      </div>
    </div>
  );
}

export function Bubble({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[var(--hc-tint)] text-[var(--hc-primary)]" aria-hidden>
        <HeartPulse className="h-6 w-6" />
      </div>
      <p className="rounded-[var(--hc-r-card)] rounded-tl-sm bg-[var(--hc-bg)] px-3 py-2 text-[16px] text-[var(--hc-text-2)]">{children}</p>
    </div>
  );
}

/** Single-choice option card. Use inside a container with role="radiogroup". */
export function OptionCard({ selected, onClick, title, sub, icon, danger }: { selected: boolean; onClick: () => void; title: string; sub?: string; icon?: ReactNode; danger?: boolean }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={cx(
        'flex min-h-14 w-full items-center gap-3 rounded-[var(--hc-r-control)] border-[1.5px] px-3 py-2 text-left transition-colors',
        selected ? 'border-[var(--hc-primary)] bg-[var(--hc-tint)]' : danger ? 'border-[var(--hc-em-border)] bg-[var(--hc-em-bg)] hover:brightness-[0.98]' : 'border-[var(--hc-control)] bg-white hover:bg-[var(--hc-bg)]',
      )}
    >
      {icon && <span className={danger ? 'text-[var(--hc-em-btn)]' : 'text-[var(--hc-primary)]'} aria-hidden>{icon}</span>}
      <span className="flex-1">
        <span className={cx('block text-[16px] font-semibold', danger && 'text-[var(--hc-em-text)]')}>{title}</span>
        {sub && <span className="block text-[15px] text-[var(--hc-muted)]">{sub}</span>}
      </span>
      {selected && <CircleCheck className="h-5 w-5 text-[var(--hc-primary)]" aria-hidden />}
    </button>
  );
}

/** Toggle chip (multi-select). For single-choice groups pass `radio`. */
export function Chip({ on, onClick, children, radio }: { on: boolean; onClick: () => void; children: ReactNode; radio?: boolean }) {
  const state = radio ? { role: 'radio' as const, 'aria-checked': on } : { 'aria-pressed': on };
  return (
    <button
      type="button"
      {...state}
      onClick={onClick}
      className={cx('inline-flex min-h-10 items-center gap-1 whitespace-nowrap rounded-full border-[1.5px] px-3 text-[15px] font-medium', on ? 'border-[var(--hc-primary)] bg-[var(--hc-tint)] text-[var(--hc-primary-dark)]' : 'border-[var(--hc-control)] bg-white')}
    >
      {on && <Check className="h-4 w-4" aria-hidden />}
      {children}
    </button>
  );
}

export function PrimaryButton({ children, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className={cx('min-h-[52px] w-full rounded-[var(--hc-r-control)] px-4 text-[17px] font-semibold', rest.disabled ? 'cursor-not-allowed border-[1.5px] border-[var(--hc-border)] bg-[var(--hc-bg)] text-[var(--hc-muted)]' : 'bg-[var(--hc-primary)] text-white hover:bg-[var(--hc-primary-dark)]', className)}
    >
      {children}
    </button>
  );
}

export function SecondaryButton({ children, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" {...rest} className={cx('min-h-11 rounded-[var(--hc-r-control)] border-[1.5px] border-[var(--hc-primary)] bg-white px-4 text-[16px] font-semibold text-[var(--hc-primary)] hover:bg-[var(--hc-tint)]', className)}>
      {children}
    </button>
  );
}

export function LinkButton({ children, onClick, className }: { children: ReactNode; onClick: () => void; className?: string }) {
  return (
    <button type="button" onClick={onClick} className={cx('min-h-8 text-[16px] font-semibold text-[var(--hc-primary)] underline underline-offset-2', className)}>
      {children}
    </button>
  );
}

export type Status = 'ok' | 'warn' | 'unknown' | 'bad' | 'info';
const statusStyle: Record<Status, { cls: string; Icon: typeof Info }> = {
  ok: { cls: 'bg-[var(--hc-ok-bg)] text-[var(--hc-ok-text)]', Icon: CircleCheck },
  warn: { cls: 'bg-[var(--hc-warn-bg)] text-[var(--hc-warn-text)]', Icon: TriangleAlert },
  unknown: { cls: 'bg-[var(--hc-unk-bg)] text-[var(--hc-text-2)]', Icon: CircleHelp },
  bad: { cls: 'bg-[var(--hc-em-bg)] text-[var(--hc-em-text)]', Icon: CircleX },
  info: { cls: 'bg-[var(--hc-tint)] text-[var(--hc-primary-dark)]', Icon: Info },
};

/** Status tag: icon + word, so it never relies on colour alone. */
export function StatusTag({ status, children, noIcon }: { status: Status; children: ReactNode; noIcon?: boolean }) {
  const { cls, Icon } = statusStyle[status];
  return (
    <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-[15px] font-semibold leading-none', cls)}>
      {!noIcon && <Icon className="h-4 w-4" aria-hidden />}
      {children}
    </span>
  );
}

export function Notice({ status, children }: { status: Status; children: ReactNode }) {
  const { cls, Icon } = statusStyle[status];
  return (
    <div className={cx('flex items-start gap-2 rounded-[var(--hc-r-control)] border px-3 py-2 text-[16px]', cls, status === 'warn' ? 'border-[var(--hc-warn-border)]' : 'border-transparent')}>
      <Icon className="mt-1 h-4 w-4 shrink-0" aria-hidden />
      <div>{children}</div>
    </div>
  );
}

export function Section({ title, children, className }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-[var(--hc-r-control)] border-[1.5px] border-[var(--hc-border)] bg-white px-[18px] py-4', className)}>
      {title && <h2 className="mb-2 text-[17px] font-bold">{title}</h2>}
      {children}
    </section>
  );
}

export function SampleBadge() {
  const t = useT();
  return <StatusTag status="warn">{t('sample_badge')}</StatusTag>;
}

export function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-[16px] text-[var(--hc-muted)]" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--hc-control)] border-t-[var(--hc-primary)] motion-reduce:animate-none" aria-hidden />
      {label}
    </div>
  );
}

/** Screen heading that receives focus on every screen change (so keyboard and screen-reader users land on it). */
export function ScreenTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h1 tabIndex={-1} data-screen-title className={cx('outline-none [text-wrap:balance]', className ?? 'text-[24px] font-bold leading-tight')}>
      {children}
    </h1>
  );
}

export function CallLink({ number, placeName, label, className }: { number: string; placeName: string; label: string; className?: string }) {
  const t = useT();
  return (
    <a href={`tel:${number}`} className={className} aria-label={t('call_place', { name: placeName })}>
      <Phone className="mr-1 inline h-4 w-4 align-[-2px]" aria-hidden />
      {label}
    </a>
  );
}

export const titleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

/** Compact "what you told us" summary: label/value rows with one Change action, aligned to the right. */
export function AnswerSummary({ rows, actionLabel, onAction }: { rows: { label: string; value: string }[]; actionLabel: string; onAction: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-[var(--hc-r-control)] border-[1.5px] border-[var(--hc-border)] bg-white px-3 py-2">
      <dl className="grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[15px]">
        {rows.filter((r) => r.value).map((r) => (
          <div key={r.label} className="contents">
            <dt className="font-semibold text-[var(--hc-text)]">{r.label}</dt>
            <dd className="text-[var(--hc-text-2)]">{r.value}</dd>
          </div>
        ))}
      </dl>
      <LinkButton onClick={onAction} className="shrink-0">{actionLabel}</LinkButton>
    </div>
  );
}

/** Animated expanding panel (grid-rows 0fr -> 1fr). Content stays in the DOM but is inert/hidden while closed. */
export function Collapse({ open, children, id }: { open: boolean; children: ReactNode; id?: string }) {
  return (
    <div id={id} className="hc-collapse" data-open={open} aria-hidden={!open} inert={!open}>
      <div>{children}</div>
    </div>
  );
}

/** Placeholder cards while results load. Pair with a visible/sr text status (Spinner-style role="status"). */
export function SkeletonCards({ n = 3, label }: { n?: number; label: string }) {
  return (
    <div className="flex flex-col gap-3">
      <p role="status" className="sr-only">{label}</p>
      <div aria-hidden className="flex flex-col gap-3">
        {Array.from({ length: n }, (_, i) => (
          <div key={i} className="flex animate-pulse flex-col gap-3 rounded-[var(--hc-r-card)] border-[1.5px] border-[var(--hc-border)] bg-white p-4 motion-reduce:animate-none">
            <div className="h-5 w-2/3 rounded-[var(--hc-r-inner)] bg-[var(--hc-unk-bg)]" />
            <div className="h-4 w-1/3 rounded-[var(--hc-r-inner)] bg-[var(--hc-unk-bg)]" />
            <div className="h-16 rounded-[var(--hc-r-inner)] bg-[var(--hc-bg)]" />
            <div className="h-11 w-28 rounded-[var(--hc-r-control)] bg-[var(--hc-unk-bg)]" />
          </div>
        ))}
      </div>
    </div>
  );
}
