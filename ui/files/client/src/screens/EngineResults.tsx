import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, Building2, Info, Ruler } from 'lucide-react';
import { useFlow } from '../flow/context';
import type { FlowState } from '../flow/state';
import { useT } from '../i18n';
import { detectSymptoms } from '../domain/symptoms';
import { chooseRadius, coarseBBox, FETCH_RADIUS_KM, formatDistance, type Point } from '../domain/geo';
import { Shell, useDesktop } from '../components/Shell';
import { placeShort } from '../domain/places';
import { StreetMap } from '../components/StreetMap';
import { CallLink, Chip, Collapse, LinkButton, Notice, ScreenTitle, SecondaryButton, SkeletonCards, titleCase } from '../components/ui';
import { ConfidenceBars, ScoreMeter } from './parts';
import { clean, isPresent } from '../engine/present';
import { distanceFactor, parseNeeds, type EngineEntry, type EngineResult, type Need } from '../engine/contract';
import { ownWordsOf } from '../engine/source';
import { findEntry, chipsToQuery, splitRelevant, MIN_MATCH } from '../engine/method';
import { EngineCandidates, type EngineLoaded } from '../engine/live';

const SERVICE_NAME: Record<string, string> = {
  emergency: 'Emergency care', ecg: 'ECG', xray: 'X-ray', lab: 'Lab tests', ct: 'CT scan', mri: 'MRI', ultrasound: 'Ultrasound',
  icu: 'ICU', inpatient: 'Inpatient beds', operating_room: 'Operating room', cath_lab: 'Cath lab', c_section: 'C-section',
  dialysis: 'Dialysis', fracture_care: 'Fracture care',
};
/** Match at or above which a place beyond the radius is still worth showing (the method's MEDIUM tier). */
const GOOD_FIT_MATCH = 0.4;
/** Places added per "Show more". */
const BATCH = 10;
/** Outside-radius places are lettered A, B, C... so they never read as ranks. */
const letter = (i: number) => String.fromCharCode(65 + (i % 26));

export const svc = (id: string) => SERVICE_NAME[id] ?? titleCase(id.replace(/_/g, ' '));
export const tier = (c: EngineResult['confidence']): 'High' | 'Medium' | 'Low' => (c === 'HIGH' ? 'High' : c === 'MEDIUM' ? 'Medium' : 'Low');
// Match the reference notebook, which truncates (0.8697 prints as 86%), so the team's numbers agree.
export const pct = (x: number) => `${Math.floor(x * 100 + 1e-9)}%`;

function NeedRow({ n }: { n: Need }) {
  const lo = n.ciLo !== null ? n.ciLo * 100 : null;
  const hi = n.ciHi !== null ? n.ciHi * 100 : null;
  const share = n.share * 100;
  const label = `${svc(n.service)}: ${pct(n.share)}${lo !== null && hi !== null ? `, likely range, 95% confidence interval ${Math.round(lo)} to ${Math.round(hi)}` : ', expert-set, no interval'}`;
  return (
    <li role="img" aria-label={label} className="flex flex-col gap-1">
      <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-[15px]">
        <span className="font-semibold">{svc(n.service)}</span>
        <span aria-hidden className="tabular-nums">
          {pct(n.share)}
          <span className="ml-2 text-[13px] text-[var(--hc-muted)]">{lo !== null && hi !== null ? `likely ${Math.round(lo)}–${Math.round(hi)}%` : 'expert-set, no interval'}</span>
        </span>
      </p>
      <span aria-hidden className="relative block h-2.5 w-full rounded-full bg-[var(--hc-bg)] ring-1 ring-inset ring-[var(--hc-border)]">
        {lo !== null && hi !== null && <span className="absolute inset-y-0 rounded-full" style={{ left: `${lo}%`, width: `${Math.max(hi - lo, 1.5)}%`, background: 'color-mix(in srgb, var(--hc-primary) 30%, transparent)' }} />}
        <span className="absolute -top-[4px] h-[18px] w-[3px] rounded-full bg-[var(--hc-primary-dark)]" style={{ left: `calc(${share}% - 1.5px)` }} />
      </span>
    </li>
  );
}

function NeedsDisclosure({ entry }: { entry: EngineEntry }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" aria-expanded={open} aria-controls="needs-panel" onClick={() => setOpen(!open)} className="inline-flex min-h-11 items-center gap-1 text-[16px] font-semibold text-[var(--hc-primary)] underline underline-offset-2">
        What similar visits involved<Chevron open={open} />
      </button>
      <Collapse open={open} id="needs-panel"><div className="pt-1"><NeedsPanel entry={entry} /></div></Collapse>
    </div>
  );
}

function NeedsPanel({ entry }: { entry: EngineEntry }) {
  const needs = useMemo(() => parseNeeds(entry.needs), [entry]);
  return (
    <section data-testid="engine-needs" aria-label="What similar visits involved" className="flex flex-col gap-2 rounded-[var(--hc-r-control)] border-[1.5px] border-[var(--hc-border)] bg-white px-3 py-3">
      <p className="text-[14px] text-[var(--hc-muted)]">{entry.source} · tolerance {entry.tolerance_km} km{entry.alternates.length > 0 ? ` · Similar complaints: ${entry.alternates.join(' · ')}` : ''}</p>
      <ul className="flex flex-col gap-3">{needs.map((n) => <NeedRow key={n.service} n={n} />)}</ul>
      <p className="text-[14px] text-[var(--hc-muted)]">Shares describe what similar emergency patients received in an emergency-visit survey (NHAMCS 2022), not your chance of needing it. Whether a place here offers it comes from its own records.</p>
    </section>
  );
}

const Chevron = ({ open }: { open: boolean }) => <ChevronDown className={`h-4 w-4 transition-transform duration-200 motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} aria-hidden />;

/** Raw structured evidence ("type=hospital capacity=425") as plain words ("Hospital · 425 beds"). */
export function evidenceText(q: string): string {
  if (!/^(\w+=\S+\s*)+$/.test(q)) return q;
  const kv = Object.fromEntries([...q.matchAll(/(\w+)=(\S+)/g)].map((m) => [m[1], m[2]]));
  const parts = [kv.type ? titleCase(kv.type.replace(/_/g, ' ')) : null, kv.capacity && Number.isFinite(Number(kv.capacity)) ? `${kv.capacity} beds` : null].filter(Boolean);
  return parts.length ? parts.join(' · ') : q;
}

export const GRADE: Record<string, string> = { documented_multi: '2+ fields', documented_single: 'one field', structured_field: 'structured field', tag_only: 'specialty tag only' };
/** Comma-joined parts that are actually present. */
export const joinPresent = (...parts: unknown[]): string => parts.map(clean).filter((x): x is string => x !== null).join(', ');
const webHref = (w: string) => (/^https?:/i.test(w) ? w : `https://${w}`);
/** Scroll and "show more" survive a trip to the details page and back. */
export const saved = { y: 0, more: 0 };
export const rememberScroll = (more: number) => { saved.y = document.getElementById('hc-main')?.scrollTop ?? 0; saved.more = more; };

/** Call as the filled primary action (same look as the details page). */
export const CALL_CLS = 'inline-flex min-h-11 items-center justify-center rounded-[var(--hc-r-control)] bg-[var(--hc-primary)] px-4 text-[16px] font-semibold tabular-nums text-white hover:bg-[var(--hc-primary-dark)]';

const TEXT_LINK = 'inline-flex min-h-11 items-center gap-1 text-[14px] font-semibold text-[var(--hc-primary)] underline underline-offset-2';

function EngineCard({ r, num, entry, unit, onOpen }: { r: EngineResult; num: string; entry: EngineEntry; unit: 'km' | 'mi'; onOpen: () => void }) {
  const [open, setOpen] = useState(false);
  const dist = distanceFactor(r.km, entry.tolerance_km);
  const titleId = `eng-${r.facility_id}`;
  const whyId = `why-${r.facility_id}`;
  const phone = clean(r.phone);
  const website = clean(r.website);
  const reasons = r.confidence_reasons.filter(isPresent);
  return (
    <article aria-labelledby={titleId} className="flex flex-col gap-3 rounded-[var(--hc-r-card)] border-[1.5px] border-[var(--hc-border)] bg-white p-4">
      <header className="flex items-start gap-3">
        <span aria-hidden className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--hc-primary)] text-[15px] font-bold text-white">{num}</span>
        <div className="min-w-0 flex-1">
          <h3 id={titleId} className="text-[18px] font-bold leading-snug [text-wrap:balance]"><span className="sr-only">{num}. </span>{r.name}</h3>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[15px] text-[var(--hc-muted)]">
            {joinPresent(clean(r.type) ? titleCase(r.type) : null, r.city) && <span className="inline-flex items-center gap-1"><Building2 className="h-4 w-4" aria-hidden />{joinPresent(clean(r.type) ? titleCase(r.type) : null, r.city)}</span>}
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1 whitespace-nowrap tabular-nums"><Ruler className="h-4 w-4" aria-hidden />{formatDistance(r.km, unit)}</span>
          </p>
        </div>
      </header>
      <div className="rounded-[var(--hc-r-inner)] bg-[var(--hc-bg)] px-3 py-3">
        <ScoreMeter score={r.score * 100} lo={r.score * 100} hi={r.score * 100} confidence={tier(r.confidence)} rangeText="Score, not a probability" />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {phone && <CallLink number={phone} placeName={r.name} label={`Call ${phone}`} className={CALL_CLS} />}
        {/* Secondary actions stay together as one group so they wrap as a unit, never one by one. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <button type="button" aria-expanded={open} aria-controls={whyId} onClick={() => setOpen(!open)} className={TEXT_LINK}>
          Why this score<Chevron open={open} />
        </button>
        <button type="button" onClick={onOpen} aria-label={`Full details: ${r.name}`} className={TEXT_LINK}>Full details</button>
        {website && <a href={webHref(website)} target="_blank" rel="noopener noreferrer" aria-label={`Website of ${r.name} (opens a new tab)`} className={TEXT_LINK}>Website ↗</a>}
        </div>
      </div>
      <Collapse open={open} id={whyId}>
        <div className="flex flex-col gap-3 text-[15px]">
          <ul className="flex flex-col gap-1.5">
            {entry.needs.map(([service]) => {
              const q = clean(r.evidence[service]);
              const has = q && q !== 'no evidence found';
              return (
                <li key={service}>
                  <span className="font-semibold">{svc(service)}:</span>{' '}
                  {has ? <span>&ldquo;{evidenceText(q)}&rdquo;</span> : <span className="text-[var(--hc-muted)]">Not listed in its record</span>}
                </li>
              );
            })}
          </ul>
          {r.location_flags.filter(isPresent).map((f) => <p key={f} className="rounded-[var(--hc-r-inner)] bg-[var(--hc-warn-bg)] px-2 py-1 text-[var(--hc-warn-text)]">{f}</p>)}
          <div className="flex flex-col gap-1">
            <h4 className="text-[14px] font-semibold text-[var(--hc-muted)]">How the number is made</h4>
            <p className="text-[14px] tabular-nums">match {r.match.toFixed(2)} × relevance {r.relevance.toFixed(2)}{clean(r.relevance_reason) ? ` (${r.relevance_reason})` : ''} × distance {dist.toFixed(2)} × trust {r.trust.toFixed(2)} = {r.score.toFixed(2)}</p>
            <p className="text-[13px] tabular-nums text-[var(--hc-muted)]">Distance factor = 1 / (1 + (km / {entry.tolerance_km})²), using this search&apos;s {entry.tolerance_km} km tolerance.</p>
            {reasons.length > 0 && <p className="text-[14px] text-[var(--hc-muted)]">{reasons.join('; ')}</p>}
          </div>
        </div>
      </Collapse>
    </article>
  );
}

function OutsideRow({ r, num, unit, onOpen }: { r: EngineResult; num: string | null; unit: 'km' | 'mi'; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} aria-label={`Full details: ${r.name}`} className="flex min-h-14 w-full items-center gap-3 rounded-[var(--hc-r-control)] border-[1.5px] border-[var(--hc-border)] bg-white px-3 py-2 text-left opacity-70 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[var(--hc-primary)]">
      <span aria-hidden className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-[15px] font-bold text-white ${num === null ? 'bg-[var(--hc-border)]' : 'bg-[var(--hc-primary)]'}`}>{num}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[16px] font-bold">{r.name}</span>
        <span className="flex flex-wrap items-center gap-x-2 text-[14px] text-[var(--hc-muted)]">
          <span className="tabular-nums">{formatDistance(r.km, unit)}</span>
          <ScoreMeter compact score={r.score * 100} lo={r.score * 100} hi={r.score * 100} confidence={tier(r.confidence)} />
          <ConfidenceBars small level={tier(r.confidence)} />
          <span className="font-semibold text-[var(--hc-primary)] underline underline-offset-2">Full details</span>
        </span>
      </span>
    </button>
  );
}

/** Resolves the ranked entry for the current search in either engine mode; shared by results and details. */
export function EntryProvider({ children }: { children: (entry: EngineEntry | null, status: 'loading' | 'error' | 'ok', clean: boolean) => ReactNode }) {
  const { s } = useFlow();
  const place = s.place as NonNullable<FlowState['place']>;
  const ids = useMemo(() => [...detectSymptoms(s.freeText, s.chips), ...(s.conditions.kidney ? ['kidney'] : [])], [s.freeText, s.chips, s.conditions.kidney]);
  const bbox = useMemo(() => coarseBBox(place, FETCH_RADIUS_KM), [place]);
  const own = ownWordsOf(s.chips, s.freeText);
  return <EngineCandidates bbox={bbox}>{(l) => <CleanBody l={l} query={chipsToQuery(ids, own)}>{children}</CleanBody>}</EngineCandidates>;
}

/** engine_clean: facilities from the read-only query, ranked in full (no cut) in the browser by method.ts. */
function CleanBody({ l, query, children }: { l: EngineLoaded; query: string; children: (entry: EngineEntry | null, status: 'loading' | 'error' | 'ok', clean: boolean) => ReactNode }) {
  const { s } = useFlow();
  const place = s.place as NonNullable<FlowState['place']>;
  const entry = useMemo(
    () => (l.loading || l.error ? null : findEntry(query, place.code, place.lat, place.lon, l.rows)),
    [l.loading, l.error, l.rows, query, place],
  );
  return <>{children(entry, l.loading ? 'loading' : l.error ? 'error' : 'ok', true)}</>;
}

export function EngineResults() {
  return <EntryProvider>{(entry, status, clean) => <EngineView entry={entry} status={status} clean={clean} />}</EntryProvider>;
}

function EngineView({ entry, status }: { entry: EngineEntry | null; status: 'loading' | 'error' | 'ok'; clean: boolean }) {
  const { s, dispatch } = useFlow();
  const t = useT();
  const set = (patch: Partial<FlowState>) => dispatch({ type: 'set', patch });
  const place = s.place as NonNullable<FlowState['place']>;
  const origin: Point = place;
  const unit = s.unit;
  const d = (km: number) => formatDistance(km, unit);
  const [more, setMore] = useState(saved.more);
  useEffect(() => {
    if (status !== 'ok' || !entry || saved.y === 0) return;
    const y = saved.y;
    saved.y = 0;
    const id = setTimeout(() => document.getElementById('hc-main')?.scrollTo(0, y), 120);
    return () => clearTimeout(id);
  }, [status, entry]);
  const split = useMemo(() => splitRelevant(entry?.results ?? [], MIN_MATCH), [entry]);
  const all = split.relevant;
  const weak = useMemo(() => [...split.weak].sort((a, b) => a.km - b.km), [split]);
  const [showWeak, setShowWeak] = useState(false);
  const auto = useMemo(() => chooseRadius(all.map((r) => r.km), s.showN), [all, s.showN]);
  const radiusKm = s.radiusKm ?? auto.radiusKm;
  const widened = s.radiusKm === null && auto.widened;
  // Post-split only: the method's order is kept inside; outside is by distance. Nothing is dropped or re-ranked.
  const inside = useMemo(() => all.filter((r) => r.km <= radiusKm), [all, radiusKm]);
  // Grey list = good fits that are just beyond the radius: Medium or High confidence (match >= 0.40, the method's own
  // tier cut-off), nearest first. Weaker places beyond the radius are not listed there.
  const outsideAll = useMemo(() => all.filter((r) => r.km > radiusKm && r.match >= GOOD_FIT_MATCH).sort((a, b) => a.km - b.km), [all, radiusKm]);
  const shown = inside.slice(0, BATCH * (1 + more));
  const outside = outsideAll.slice(0, 10);
  const open = (r: EngineResult) => { rememberScroll(more); set({ selectedId: r.facility_id, screen: 'detail' }); };
  // The map shows EVERY ranked place inside the radius (numbered by rank); the list pages through the same ranking.
  // Numbered pins for the places shown in the list; small dots for the rest of the ranking (true location, rank on hover);
  // lettered grey pins for good matches just outside the radius.
  const pins = [
    ...inside.map((r, i) => [r, String(i + 1), false, i >= shown.length] as const),
    ...outside.map((r, i) => [r, letter(i), true, false] as const),
  ].flatMap(([r, n, muted, dot]) =>
    r.lat !== undefined && r.lon !== undefined && Number.isFinite(r.lat) && Number.isFinite(r.lon) ? [{ id: r.facility_id, lat: r.lat, lon: r.lon, label: n, name: r.name, muted, dot }] : []);
  const desktop = useDesktop();
  const left = (
    <div className="relative h-full">
      <StreetMap origin={origin} radiusKm={radiusKm} points={pins} onSelect={(id) => { const r = all.find((x) => x.facility_id === id); if (r) open(r); }} ariaLabel={`Map around ${placeShort(place)}`} youLabel={t('you')} />
      {pins.length === 0 && (
        <p className="absolute bottom-4 left-4 right-4 z-[500] rounded-[var(--hc-r-control)] bg-white/95 px-4 py-3 text-[15px] shadow-[0_4px_16px_rgb(23_33_31/0.12)]">
          {placeShort(place)}. {status === 'ok' && entry ? 'No places with coordinates to pin.' : 'The demo results list distances but no coordinates, so places are not pinned on the map yet.'}
        </p>
      )}
    </div>
  );
  const critical = entry?.meta.critical ?? false;
  const advisory = entry && isPresent(entry.meta.advisory) ? entry.meta.advisory : undefined;
  return (
    <Shell
      footer={t('not_advice')}
      left={left}
      bannerText={critical ? advisory : undefined}
      bannerExtra={critical ? undefined : advisory}
      right={
        <>
          <div className="flex flex-col gap-1">
            <ScreenTitle>{entry ? `Health care near ${placeShort(place)}` : 'Results'}</ScreenTitle>
            {entry && <p className="text-[16px] text-[var(--hc-muted)] [text-wrap:balance]">For {entry.label.replace(/\s*\([^)]*\.\.\.$/, '')} · {all.length === 1 ? '1 place' : `${all.length} places`}</p>}
          </div>
          {status === 'loading' ? (
            <SkeletonCards label="Loading places near you" />
          ) : status === 'error' ? (
            <Notice status="bad">Could not load places. Please try again.</Notice>
          ) : !entry ? (
            <Notice status="unknown">No matching places found near here.</Notice>
          ) : (
            <>
              {!desktop && <div className="h-[220px] overflow-hidden rounded-[var(--hc-r-card)] border-[1.5px] border-[var(--hc-border)]">{left}</div>}
              <div className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[15px]">
                  <label className="inline-flex items-center gap-2 font-semibold">
                    Within
                    <input type="range" min={5} max={250} step={5} value={radiusKm} onChange={(e) => { setMore(0); set({ radiusKm: Number(e.target.value) }); }} className="w-36" />
                    <span className="font-normal tabular-nums">{d(radiusKm)}</span>
                  </label>
                  <div role="radiogroup" aria-label="Distance unit" className="ml-auto flex gap-1">
                    <Chip radio on={unit === 'km'} onClick={() => set({ unit: 'km' })}>km</Chip>
                    <Chip radio on={unit === 'mi'} onClick={() => set({ unit: 'mi' })}>mi</Chip>
                  </div>
                </div>
                <p className="text-[15px] text-[var(--hc-muted)]">Sorted by best match. Distances are straight-line; the distance only hides or shows places.{s.radiusKm === null ? ' Radius set automatically.' : ''}</p>
              </div>
              {widened && <p className="flex items-start gap-1.5 text-[15px] text-[var(--hc-primary-dark)]"><Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{t('widened', { from: d(25), to: d(radiusKm) })}</p>}
              {shown.length === 0 && (
                s.radiusKm !== null ? (
                  <Notice status="unknown">
                    No places within {d(radiusKm)}. The nearest ones are listed under Outside your radius.{' '}
                    <LinkButton onClick={() => set({ radiusKm: null })}>Widen automatically</LinkButton>
                  </Notice>
                ) : <Notice status="unknown">No places within {d(radiusKm)}.</Notice>
              )}
              {shown.map((r, i) => <EngineCard key={r.facility_id} r={r} num={String(i + 1)} entry={entry} unit={unit} onOpen={() => open(r)} />)}
              {(inside.length > shown.length || more > 0) && (
                <div className="flex gap-2">
                  {inside.length > shown.length && (
                    <SecondaryButton className="flex-1" onClick={() => setMore(more + 1)}>Show more ({inside.length - shown.length} left)</SecondaryButton>
                  )}
                  {more > 0 && (
                    <SecondaryButton className="flex-1" onClick={() => setMore(Math.max(0, more - 1))}>Show less</SecondaryButton>
                  )}
                </div>
              )}
              {outside.length > 0 && shown.length < inside.length && (
                <p className="text-[14px] text-[var(--hc-muted)]">{outside.length} good {outside.length === 1 ? 'match is' : 'matches are'} just beyond {d(radiusKm)}: grey pins {letter(0)}{outside.length > 1 ? `–${letter(outside.length - 1)}` : ''} on the map. They are listed after the places inside your radius.</p>
              )}
              {/* Places beyond the radius are listed only after the whole in-radius ranking has been shown, so they never jump ahead of unseen closer options. */}
              {outside.length > 0 && shown.length >= inside.length && (
                <>
                  <h2 className="text-[18px] font-bold">Outside your radius</h2>
                  <p className="-mt-2 text-[14px] text-[var(--hc-muted)]">Good matches just beyond {d(radiusKm)} (medium or high confidence), nearest first. Letters, not ranks.</p>
                  <ul className="flex flex-col gap-2">
                    {outside.map((r, i) => <li key={r.facility_id}><OutsideRow r={r} num={letter(i)} unit={unit} onOpen={() => open(r)} /></li>)}
                  </ul>
                </>
              )}
              {weak.length > 0 && (
                <>
                  <button type="button" aria-expanded={showWeak} onClick={() => setShowWeak(!showWeak)} className="inline-flex min-h-11 items-center gap-1 self-start text-[15px] font-semibold text-[var(--hc-primary)] underline underline-offset-2">
                    Show {weak.length} places with little or no evidence for this care<Chevron open={showWeak} />
                  </button>
                  <p className="text-[14px] text-[var(--hc-muted)]">Their records do not clearly list the services this kind of visit usually needs.</p>
                  {showWeak && (
                    <ul className="flex flex-col gap-2">
                      {weak.map((r) => <li key={r.facility_id}><OutsideRow r={r} num={null} unit={unit} onOpen={() => open(r)} /></li>)}
                    </ul>
                  )}
                </>
              )}
              <NeedsDisclosure entry={entry} />
            </>
          )}
          <SecondaryButton onClick={() => set({ screen: 'symptoms' })}>Change symptoms</SecondaryButton>
          <LinkButton className="self-start" onClick={() => set({ screen: 'place' })}>Change place</LinkButton>
        </>
      }
    />
  );
}
