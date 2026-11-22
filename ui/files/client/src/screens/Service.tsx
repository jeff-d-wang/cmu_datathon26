import { useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { useFlow } from '../flow/context';
import { useT } from '../i18n';
import { QUICK_REQUESTS, requestById, searchRequests } from '../domain/requests';
import { serviceName } from '../domain/services';
import { Shell } from '../components/Shell';
import { Chip, LinkButton, PrimaryButton, ScreenTitle, StepHeader } from '../components/ui';
import { PlaceCountPanel } from './Onboarding';

/** Typeahead over curated requests and the 192-service catalog (ARIA combobox, same pattern as PlaceSearch). */
function ServiceSearch({ onPick }: { onPick: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const hits = searchRequests(q);
  const showList = open && q.trim().length >= 2;
  const pick = (id: string) => {
    onPick(id);
    setQ(requestById(id)?.name ?? '');
    setOpen(false);
    inputRef.current?.focus();
  };
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showList || hits.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % hits.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + hits.length) % hits.length); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(hits[active].id); }
    else if (e.key === 'Escape') { setOpen(false); }
  };
  return (
    <div className="relative">
      <label htmlFor="service" className="block text-[16px] font-semibold">Service, treatment or test</label>
      <div className="relative mt-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[var(--hc-muted)]" aria-hidden />
        <input
          id="service"
          ref={inputRef}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls="service-list"
          aria-activedescendant={showList && hits[active] ? `service-opt-${active}` : undefined}
          autoComplete="off"
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKey}
          placeholder="For example dialysis, MRI, emergency C-section"
          className="min-h-12 w-full rounded-[var(--hc-r-control)] border-[1.5px] border-[var(--hc-control)] bg-white pl-10 pr-3 text-[16px]"
        />
        {showList && (
          <ul id="service-list" role="listbox" aria-label="Service, treatment or test" className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-[var(--hc-r-control)] border-[1.5px] border-[var(--hc-border)] bg-white py-1 shadow-[0_8px_24px_rgb(23_33_31/0.12)]">
            {hits.length === 0 && <li role="presentation" className="px-3 py-2 text-[15px] text-[var(--hc-muted)]">No matching service. Try another word.</li>}
            {hits.map((r, i) => (
              <li
                key={r.id}
                id={`service-opt-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => { e.preventDefault(); pick(r.id); }}
                onMouseEnter={() => setActive(i)}
                className={`flex min-h-11 cursor-pointer items-center px-3 py-1.5 text-[16px] ${i === active ? 'bg-[var(--hc-tint)] text-[var(--hc-primary-dark)]' : ''}`}
              >
                {r.name}
              </li>
            ))}
          </ul>
        )}
      </div>
      <p role="status" className="sr-only">{showList ? `${hits.length} services found` : ''}</p>
    </div>
  );
}

/** Step 3 (service path): what care is needed. The pick is stored as s.service. */
export function ServiceScreen() {
  const { s, dispatch } = useFlow();
  const t = useT();
  const req = s.service ? requestById(s.service) : undefined;
  const choose = (id: string) => dispatch({ type: 'set', patch: { service: id } });
  return (
    <Shell
      left={<PlaceCountPanel />}
      right={
        <>
          <StepHeader step={3} />
          <ScreenTitle>{t('title_service')}</ScreenTitle>
          <section className="flex flex-col gap-2 rounded-[var(--hc-r-card)] border-2 border-[var(--hc-primary)] p-4">
            <ServiceSearch onPick={choose} />
            <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Common requests">
              <span className="text-[15px] text-[var(--hc-muted)]">Common requests:</span>
              {QUICK_REQUESTS.map((id) => (
                <Chip radio key={id} on={s.service === id} onClick={() => choose(id)}>{requestById(id)?.name}</Chip>
              ))}
            </div>
          </section>
          {req && (
            <section aria-live="polite" className="flex flex-col gap-1">
              <p className="text-[18px] font-bold">{req.name}</p>
              {req.note && <p className="text-[15px] text-[var(--hc-muted)]">{req.note}</p>}
              <p className="text-[15px] font-semibold">We look for:</p>
              <ul className="list-disc pl-5 text-[15px]">
                {req.needs.map((n) => (
                  <li key={n.service}>{serviceName(n.service)}{n.critical ? ' (required)' : ''}</li>
                ))}
              </ul>
            </section>
          )}
          <PrimaryButton disabled={!req} onClick={() => dispatch({ type: 'go', screen: 'results' })}>{t('continue')}</PrimaryButton>
          <LinkButton className="self-start" onClick={() => dispatch({ type: 'go', screen: 'who' })}>Add patient details (optional)</LinkButton>
        </>
      }
    />
  );
}
