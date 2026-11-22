import { useMemo, useState } from 'react';
import { useFlow } from '../flow/context';
import { modeFor, shareFragment, type FlowState } from '../flow/state';
import { symptomLabel, useT } from '../i18n';
import type { StringKey } from '../i18n/en';
import { parseServices, serviceName, type Need } from '../domain/services';
import { chooseRadius, coarseBBox, FETCH_RADIUS_KM, formatDistance, type Point, haversineKm } from '../domain/geo';
import { isRelevant, rankFacilities, type Ranked } from '../domain/ranking';
import { detectSymptoms, needsForSymptoms, showsEmergencyBannerFirst } from '../domain/symptoms';
import { assessLayerA, CARE_LEVEL_LABEL } from '../domain/severity';
import { splitByRadius } from '../domain/radius';
import { outsideBar, outsideReason } from '../domain/outside';
import { WEIGHTS, type ComponentId } from '../domain/score';
import { requestById, requiredService } from '../domain/requests';
import { LayerAPanel } from './CarePanels';
import { parseAge } from '../domain/redflags';
import type { Facility } from '../domain/types';
import { Candidates, DATA_SOURCE } from '../data/source';
import { EngineResults } from './EngineResults';
import { EngineCandidates } from '../engine/live';
import { Shell } from '../components/Shell';
import { IndiaInset } from '../components/MapPanel';
import { StreetMap } from '../components/StreetMap';
import { Building2, ChevronDown, Info, Ruler, ShieldCheck, Siren } from 'lucide-react';
import { CallLink, Chip, LinkButton, Notice, SampleBadge, ScreenTitle, SecondaryButton, Spinner, titleCase } from '../components/ui';
import { HowOrdered, TierTag, WarningList, ConfidenceBars, ScoreMeter } from './parts';
import { COMPONENT_TEXT } from './HowScore';

export const FETCH_LIMIT = 400;

/** Common general services shown as filter chips beyond the symptom-suggested ones. */
const DEFAULT_CHIPS: readonly string[] = ['healthCheckupPackages', 'diagnosticServices', 'emergencyCare', 'icu'];
/** Places added per "Show more". */
const BATCH = 10;
/** Grey pins outside the radius get letters, not ranks. */
const letter = (i: number) => String.fromCharCode(65 + (i % 26));

export function useRankedResults(s: FlowState, facilities: Facility[]) {
  return useMemo(() => {
    if (!s.place) return { ranked: [] as Ranked[], needs: [] as Need[], radiusKm: 25, widened: false, auto: true };
    const origin: Point = s.place;
    const age = parseAge(s.ageRaw).age;
    const mode = modeFor(s.intent, s.service);
    const request = s.intent === 'service' && s.service ? requestById(s.service) : undefined;
    // Symptom rules -> weighted needs vector over the 192-service catalog, built in the
    // browser (Layer A). Critical needs hard-filter; the rest only order.
    const needs = request ? request.needs : needsForSymptoms(detectSymptoms(s.freeText, s.chips), mode);
    const pool = facilities.filter(
      (f) => (s.ownership === 'any' || f.ownership === s.ownership) && (s.serviceFilter === 'any' || parseServices(f.services).has(s.serviceFilter)),
    );
    const all = rankFacilities(pool, { mode, origin, needs, conditions: s.conditions, age, unit: s.unit });
    // Widen until enough places WITH EVIDENCE (tier A/B) are in range, not just any place.
    const auto = chooseRadius(all.filter(isRelevant).map((r) => r.km), s.showN);
    const radiusKm = s.radiusKm ?? auto.radiusKm;
    return { ranked: all, needs, radiusKm, widened: s.radiusKm === null && auto.widened, auto: s.radiusKm === null };
  }, [s.radiusKm, s.place, s.ageRaw, s.intent, s.service, s.freeText, s.chips, s.serviceFilter, s.ownership, s.conditions, s.showN, s.unit, facilities]);
}

function ShareBar() {
  const { s } = useFlow();
  const t = useT();
  const [copied, setCopied] = useState(false);
  const url = () => `${window.location.origin}${window.location.pathname}${shareFragment(s)}`;
  return (
    <div className="flex flex-wrap items-center gap-2 text-[16px] hc-no-print">
      <LinkButton onClick={() => { void navigator.clipboard?.writeText(url()); setCopied(true); }}>{t('copy_link')}</LinkButton>·
      <a className="font-semibold text-[var(--hc-primary)] underline" target="_blank" rel="noreferrer noopener" href={`https://wa.me/?text=${encodeURIComponent(url())}`}>{t('whatsapp')}</a>·
      <LinkButton onClick={() => window.print()}>{t('print')}</LinkButton>
      <span role="status" className="text-[15px] text-[var(--hc-ok-text)]">{copied ? t('copied') : ''}</span>
      <span className="w-full text-[15px] text-[var(--hc-muted)]">{t('share_note')}</span>
    </div>
  );
}

const distText = formatDistance;
const pts = (lo: number, hi: number) => (Math.round(lo) === Math.round(hi) ? `${Math.round(lo)}` : `${Math.round(lo)}–${Math.round(hi)}`);

function ScoreDetails({ r }: { r: Ranked }) {
  return (
    <ul className="flex flex-col gap-2 text-[15px]">
      {r.score.components.map((c) => (
        <li key={c.id}>
          <p className="font-semibold">
            {COMPONENT_TEXT[c.id].name}{c.id === 'reputation' ? ' (self-reported web signals, not patient ratings)' : ''}
            <span className="ml-2 font-normal text-[var(--hc-text-2)]">{pts(c.lo, c.hi)} of {c.weight} points</span>
          </p>
          <ul className="list-disc pl-5">
            {c.evidence.map((e, i) => (
              <li key={i} className={e.flag ? 'rounded bg-[var(--hc-warn-bg)] px-1 text-[var(--hc-warn-text)]' : ''}>
                {e.text}
                {e.quote && <> <em>“{e.quote}”</em></>}
                {e.source && <span className="text-[var(--hc-muted)]"> · Source: {e.source}</span>}
                {e.unknown && <span className="ml-1 rounded border border-[var(--hc-control)] px-1 text-[13px] text-[var(--hc-muted)]">unknown</span>}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

function ResultCard({ r, rank, onOpen, muted, unit }: { r: Ranked; rank: number; onOpen: () => void; muted?: boolean; unit: 'km' | 'mi' }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const sc = r.score;
  const f = r.facility;
  const own = t(f.ownership === 'private' ? 'ownership_private' : f.ownership === 'public' ? 'ownership_public' : 'ownership_unknown');
  const warn = r.warnings.length > 0;
  const titleId = `card-${f.unique_id}`;
  return (
    <article aria-labelledby={titleId} className={`flex flex-col gap-3 rounded-[var(--hc-r-card)] border-[1.5px] border-[var(--hc-border)] bg-white p-4${muted ? ' opacity-70' : ''}`}>
      <header className="flex items-start gap-3">
        <span aria-hidden className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full text-[15px] font-bold ${warn ? 'border-2 border-[#6a5400] bg-white text-[#6a5400]' : 'bg-[var(--hc-primary)] text-white'}`}>{rank}</span>
        <div className="min-w-0 flex-1">
          <h3 id={titleId} className="text-[18px] font-bold leading-snug [text-wrap:balance]">
            <span className="sr-only">{rank}. </span>
            {f.name}
          </h3>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[15px] text-[var(--hc-muted)]">
            <span className="inline-flex items-center gap-1"><Building2 className="h-4 w-4" aria-hidden />{titleCase(f.facility_class)}, {own}</span>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1 whitespace-nowrap"><Ruler className="h-4 w-4" aria-hidden />{distText(r.km, unit)} (straight line)</span>
          </p>
        </div>
      </header>
      <div className="flex flex-wrap items-center gap-2">
        <TierTag tier={r.tier} />
        {f.loc_approx && <span className="rounded-full border border-[var(--hc-warn-border)] bg-[var(--hc-warn-bg)] px-2 py-0.5 text-[14px] font-medium text-[var(--hc-warn-text)]">Approximate location</span>}
      </div>
      <div className="rounded-[var(--hc-r-control)] bg-[var(--hc-bg)] px-3 py-3">
        <ScoreMeter score={sc.score} lo={sc.lo} hi={sc.hi} confidence={sc.confidence} />
      </div>
      <p className="text-[15px]"><span className="font-semibold">Why it is here:</span> {sc.why}</p>
      <dl className="grid grid-cols-[20px_1fr] gap-x-2 gap-y-1.5 text-[16px]">
        <dt><ShieldCheck className="mt-0.5 h-5 w-5 text-[var(--hc-primary)]" aria-label={t('evidence_word')} /></dt>
        <dd>{r.matched.length > 0 ? r.matched.slice(0, 3).map((m) => serviceName(m.service)).join(', ') : t('why_D')}</dd>
        <dt><Siren className="mt-0.5 h-5 w-5 text-[var(--hc-em-btn)]" aria-label={t('emergency_row')} /></dt>
        <dd>{t(r.emergency === 'backed' ? 'em_backed_short' : r.emergency === 'claimed' ? 'em_claimed_short' : 'em_none')}</dd>
      </dl>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="inline-flex min-h-9 items-center gap-1 self-start text-[15px] font-semibold text-[var(--hc-primary)] underline underline-offset-2">
        Why this score<ChevronDown className={`h-4 w-4 ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && <ScoreDetails r={r} />}
      <WarningList warnings={r.warnings} />
      {f.list_truncated && (
        <p className="flex items-start gap-1.5 text-[15px] text-[var(--hc-muted)]"><Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{t('data_note_truncated')}</p>
      )}
      <div className="flex gap-2">
        {f.official_phone && <CallLink number={f.official_phone} placeName={f.name} label={t('call')} className="flex min-h-11 flex-1 items-center justify-center rounded-[var(--hc-r-control)] bg-[var(--hc-primary)] px-3 text-[16px] font-semibold text-white hover:bg-[var(--hc-primary-dark)]" />}
        <SecondaryButton className="flex-1" onClick={onOpen} aria-label={`${t('full_details')}: ${f.name}`}>{t('full_details')}</SecondaryButton>
      </div>
    </article>
  );
}

function OutsideRow({ r, num, onOpen, unit, reason }: { r: Ranked; num: string | null; onOpen: () => void; unit: 'km' | 'mi'; reason?: string }) {
  const sc = r.score;
  const f = r.facility;
  return (
    <button type="button" onClick={onOpen} aria-label={`Full details: ${f.name}`} className="flex min-h-14 w-full items-center gap-3 rounded-[var(--hc-r-control)] border-[1.5px] border-[var(--hc-border)] bg-white px-3 py-2 text-left opacity-70 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[var(--hc-primary)]">
      {num !== null && <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#6b7472] text-[15px] font-bold text-white">{num}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[16px] font-bold">{f.name}</span>
        <span className="flex flex-wrap items-center gap-x-2 text-[14px] text-[var(--hc-muted)]">
          <span>{distText(r.km, unit)}</span>
          <ScoreMeter compact score={sc.score} lo={sc.lo} hi={sc.hi} confidence={sc.confidence} />
          <span className="sr-only">Match score {Math.round(sc.score)}</span>
          <ConfidenceBars small level={sc.confidence} />
          {f.loc_approx && <span className="rounded-full border border-[var(--hc-warn-border)] bg-[var(--hc-warn-bg)] px-2 text-[13px] font-medium text-[var(--hc-warn-text)]">Approximate location</span>}
        </span>
        {reason && <span className="mt-1 block text-[14px] text-[var(--hc-text-2)]">{reason}</span>}
      </span>
    </button>
  );
}

const CONDITION_TEXT: Record<string, string> = {
  pregnant: 'places listing maternity and newborn care get extra points',
  kidney: 'places listing dialysis get extra points',
  stroke: 'places listing neurology get extra points',
  diabetes: 'places listing diabetes care get extra points',
};

function Assumed({ rows }: { rows: { label: string; value: string; screen: FlowState['screen'] | null }[] }) {
  const { dispatch } = useFlow();
  return (
    <section aria-labelledby="assumed-title" className="rounded-[var(--hc-r-control)] border-[1.5px] border-[var(--hc-border)] bg-white px-3 py-2">
      <h2 id="assumed-title" className="text-[17px] font-bold">What we assumed</h2>
      <dl className="mt-1 flex flex-col gap-1 text-[15px]">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline gap-2">
            <dt className="w-28 shrink-0 font-semibold">{r.label}</dt>
            <dd className="min-w-0 flex-1 text-[var(--hc-text-2)]">{r.value || 'not given'}</dd>
            {r.screen && <LinkButton className="shrink-0 !text-[15px]" onClick={() => dispatch({ type: 'go', screen: r.screen as FlowState['screen'] })}>Edit<span className="sr-only"> {r.label}</span></LinkButton>}
          </div>
        ))}
      </dl>
    </section>
  );
}

function ResultsBody({ facilities, loading, error, warming, sample }: { facilities: Facility[]; loading: boolean; error: string | null; warming: boolean; sample: boolean }) {
  const { s, dispatch } = useFlow();
  const t = useT();
  const [showMap, setShowMap] = useState(true);
  const [more, setMore] = useState(0);
  const [showWeak, setShowWeak] = useState(false);
  const { ranked, needs, radiusKm, widened, auto } = useRankedResults(s, facilities);
  const { inside: insideAll, outside: outsideAll } = useMemo(() => splitByRadius(ranked, radiusKm), [ranked, radiusKm]);
  // The list is every place inside the radius with evidence for this care (tier A/B), in ranked order, paged by "Show more".
  const inside = useMemo(() => insideAll.filter(isRelevant), [insideAll]);
  // Places inside the radius with little or no evidence for this care: behind a toggle, nearest first.
  const weak = useMemo(() => insideAll.filter((r) => !isRelevant(r)).sort((a, b) => a.km - b.km), [insideAll]);
  const shown = inside.slice(0, BATCH * (1 + more));
  // Beyond the radius: a lettered grey pin and a row in the grey list only for places that are really relevant: strong
  // evidence for this case (tier A) AND a match score close to the best places inside the radius (outsideBar), nearest
  // first. Other places with strong or moderate evidence (tier A/B) are small grey dots on the map; weaker ones are hidden.
  const bar = useMemo(() => outsideBar(inside), [inside]);
  const outside = useMemo(() => outsideAll.filter((r) => r.tier === 'A' && r.score.score >= bar).slice(0, 10), [outsideAll, bar]);
  const outsideDots = useMemo(() => outsideAll.filter((r) => (r.tier === 'A' || r.tier === 'B') && !outside.includes(r)).slice(0, 60), [outsideAll, outside]);
  const origin = s.place as Point;
  const symptomIds = detectSymptoms(s.freeText, s.chips);
  const ageNum = parseAge(s.ageRaw).age;
  const mode = modeFor(s.intent, s.service);
  const request = s.intent === 'service' && s.service ? requestById(s.service) : undefined;
  const layerA = useMemo(() => assessLayerA(symptomIds, false, mode, ageNum !== null && ageNum < 18), [symptomIds, mode, ageNum]);
  const chestFirst = !request && showsEmergencyBannerFirst(symptomIds);
  const capped = !sample && facilities.length >= FETCH_LIMIT;
  const set = (patch: Partial<FlowState>) => dispatch({ type: 'set', patch });
  const unit = s.unit;
  const d = (km: number) => distText(km, unit);

  // The map shows every ranked place inside the radius: numbered pins for the places shown in the list, small dots for the
  // rest of the ranking (true location, rank on hover), and lettered grey pins for good matches just outside the radius.
  const pins = [
    ...inside.map((r, i) => ({ id: r.facility.unique_id, lat: r.facility.lat, lon: r.facility.lon, label: String(i + 1), name: r.facility.name, warn: r.warnings.length > 0, dot: i >= shown.length })),
    ...outside.map((r, i) => ({ id: r.facility.unique_id, lat: r.facility.lat, lon: r.facility.lon, label: letter(i), name: r.facility.name, muted: true })),
    ...outsideDots.map((r) => ({ id: r.facility.unique_id, lat: r.facility.lat, lon: r.facility.lon, label: 'Outside your radius', name: r.facility.name, muted: true, dot: true })),
  ].filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  const toSelect = (id: string) => set({ selectedId: id, screen: 'detail' });
  const left = !showMap ? (
    <div className="grid h-full place-items-center bg-[var(--hc-map)]">
      <SecondaryButton onClick={() => setShowMap(true)}>{t('load_map')}</SecondaryButton>
    </div>
  ) : (
    <div className="relative h-full">
      <StreetMap origin={origin} radiusKm={radiusKm} points={pins} onSelect={toSelect} ariaLabel={t('map_name', { n: inside.length, d: d(radiusKm) })} youLabel={t('you')} />
      <div className="pointer-events-none absolute inset-x-4 top-4 z-[1000] flex items-start justify-between gap-2">
        <button type="button" onClick={() => setShowMap(false)} className="pointer-events-auto min-h-9 rounded-full bg-white px-4 text-[15px] font-semibold text-[var(--hc-text-2)] underline shadow-[0_2px_8px_rgb(23_33_31/0.18)]">{t('hide_map')}</button>
        <div className="pointer-events-auto"><IndiaInset at={origin} /></div>
      </div>
      <p className="absolute bottom-6 left-4 right-4 z-[1000] rounded-lg bg-white/95 px-3 py-2 text-[15px] text-[var(--hc-text-2)] shadow-[0_2px_8px_rgb(23_33_31/0.12)]">
        {t('map_legend')} {t('street_map_note')}
      </p>
    </div>
  );

  const top2 = Object.entries(WEIGHTS[mode]).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([id]) => COMPONENT_TEXT[id as ComponentId].name.toLowerCase());
  const condNotes = (Object.keys(CONDITION_TEXT) as (keyof typeof s.conditions)[]).filter((k) => s.conditions[k]).map((k) => CONDITION_TEXT[k]);
  if (ageNum !== null && ageNum < 18) condNotes.push("places listing children's care get extra points");
  const condNames = (Object.keys(CONDITION_TEXT) as (keyof typeof s.conditions)[]).filter((k) => s.conditions[k]);
  const patient = [ageNum !== null ? `age ${ageNum}` : null, s.sex ? t(s.sex === 'other' ? 'sex_other' : s.sex) : null, ...condNames].filter(Boolean).join(', ');

  // Service chips: the needs suggested by the symptoms first, then common general services, each with a count inside the radius.
  const suggestedChips = useMemo(() => [...new Set(needs.map((n) => n.service))].slice(0, 4), [needs]);
  const chipOrder = useMemo(() => [...suggestedChips, ...DEFAULT_CHIPS.filter((l) => !suggestedChips.includes(l))], [suggestedChips]);
  const chipCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of facilities) {
      if (s.ownership !== 'any' && f.ownership !== s.ownership) continue;
      if (haversineKm(origin, f) > radiusKm) continue;
      for (const l of parseServices(f.services).keys()) m.set(l, (m.get(l) ?? 0) + 1);
    }
    return m;
  }, [facilities, s.ownership, origin, radiusKm]);
  const chipCount = (l: string) => chipCounts.get(l) ?? 0;
  return (
    <Shell
      footer={t('not_advice')}
      left={left}
      bannerExtra={chestFirst ? t('advice_chest') : undefined}
      right={
        <>
          <Assumed
            rows={[
              { label: 'Place', value: s.place ? [s.place.district, s.place.state].filter(Boolean).map(titleCase).join(', ') : '', screen: 'place' },
              ...(request
                ? [
                    { label: 'Service', value: request.name, screen: 'service' as const },
                    { label: 'Patient', value: patient, screen: 'who' as const },
                  ]
                : [
                    { label: 'Need', value: t('intent_soon'), screen: 'intent' as const },
                    { label: 'Patient', value: patient, screen: 'who' as const },
                    { label: 'Symptoms', value: symptomIds.map((id) => symptomLabel(t, id)).join(', '), screen: 'symptoms' as const },
                    { label: 'Severity', value: t(`tier_${layerA.tier}` as StringKey), screen: null },
                    { label: 'Care level', value: layerA.careLevels.map(CARE_LEVEL_LABEL).join(', '), screen: null },
                  ]),
              { label: 'Radius', value: `${d(radiusKm)}${auto ? ' (automatic)' : ''}`, screen: null },
              { label: 'What changed the order', value: `Mostly ${top2.join(' and ')}.${condNotes.length ? ` ${condNotes.join('; ')}.` : ''}`, screen: null },
            ]}
          />
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-3">
              <ScreenTitle>{(inside.length === 1 ? t('match_title_one') : t('matches_title', { n: inside.length }))}</ScreenTitle>
              {sample && <SampleBadge />}
            </div>
            {request?.note && <Notice status="info">{request.note}</Notice>}
            <p role="status" className="sr-only">{(inside.length === 1 ? t('match_title_one') : t('matches_title', { n: inside.length }))}</p>
            <p className="text-[15px] text-[var(--hc-muted)]">Scores have a range. The range is wide when we do not know much about this place.</p>
            <LinkButton className="self-start" onClick={() => dispatch({ type: 'go', screen: 'howscore' })}>How we score</LinkButton>
            <div className="flex items-center justify-between gap-3 text-[15px] text-[var(--hc-muted)]">
              <span className="inline-flex items-center gap-1.5"><Ruler className="h-4 w-4" aria-hidden />within {d(radiusKm)} (straight line)</span>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-[15px]">
              <label className="inline-flex items-center gap-2 font-semibold">
                Search radius
                <input type="range" min={5} max={250} step={5} value={radiusKm} onChange={(e) => { setMore(0); set({ radiusKm: Number(e.target.value) }); }} className="w-40" />
                <span className="font-normal tabular-nums">{d(radiusKm)}</span>
              </label>
              <div role="radiogroup" aria-label="Distance unit" className="flex gap-2">
                <Chip radio on={unit === 'km'} onClick={() => set({ unit: 'km' })}>km</Chip>
                <Chip radio on={unit === 'mi'} onClick={() => set({ unit: 'mi' })}>mi</Chip>
              </div>
            </div>
            {widened && (
              <p className="flex items-start gap-1.5 text-[15px] text-[var(--hc-primary-dark)]"><Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{t('widened', { from: d(25), to: d(radiusKm) })}</p>
            )}
          </div>
          <p className="text-[15px] text-[var(--hc-muted)]">{t('matches_note', { order: request ? `evidence that they offer ${request.name.toLowerCase()}` : t(mode === 'urgent' ? 'order_urgent' : 'order_planned') })}</p>
          <HowOrdered mode={mode} />
          {capped && <Notice status="info">{t('capped_note')}</Notice>}
          {!request && <LayerAPanel a={layerA} tier={layerA.tier} />}
          <div role="group" aria-label={t('filter_title')}>
            <p className="mb-1 text-[16px] font-semibold">{t('filter_title')}</p>
            <div className="flex flex-wrap gap-2">
              <Chip radio on={s.serviceFilter === 'any'} onClick={() => set({ serviceFilter: 'any' })}>{t('any_care')}</Chip>
              {chipOrder.map((l) => (
                <Chip radio key={l} on={s.serviceFilter === l} onClick={() => set({ serviceFilter: l })}>
                  {serviceName(l)}
                  <span className={`ml-1 rounded-full px-1.5 text-[13px] tabular-nums ${chipCount(l) === 0 ? 'text-[var(--hc-muted)]' : 'bg-[var(--hc-bg)] text-[var(--hc-text)]'}`}>{chipCount(l)}</span>
                </Chip>
              ))}
            </div>
            <p className="mt-1 text-[15px] text-[var(--hc-muted)]">
              {suggestedChips.length > 0 && <>The first {suggestedChips.length === 1 ? 'one is' : `${suggestedChips.length} are`} {request ? 'from the service you asked for' : 'suggested from your symptoms'}. </>}
              Numbers are places within {d(radiusKm)} that list it. {t('truncation_note')}
            </p>
          </div>
          {warming && <Spinner label={t('warehouse_starting')} />}
          {loading && !warming && <Spinner label={t('loading_results')} />}
          {error && <Notice status="bad">{t('error_data')} ({error})</Notice>}
          {!loading && !error && shown.length === 0 && (
            s.radiusKm !== null ? (
              <Notice status="unknown">
                No places within {d(radiusKm)}. The nearest ones are listed under Outside your radius.{' '}
                <LinkButton onClick={() => set({ radiusKm: null })}>Widen automatically</LinkButton>
              </Notice>
            ) : request ? (
              <Notice status="unknown">
                No place within {d(radiusKm)} has medium or high evidence for {request.name.toLowerCase()} in our data. That does not prove none offers it: the data covers about 10,000 places and its lists are incomplete. Ask the nearest district hospital, and in an emergency call 108 or 112.
              </Notice>
            ) : (
              <Notice status="unknown">{t('no_results')} {t('no_results_hint')}</Notice>
            )
          )}
          <h2 className="sr-only">{t('matches_heading')}</h2>
          {shown.map((r, i) => (
            <ResultCard key={r.facility.unique_id} r={r} rank={i + 1} unit={unit} onOpen={() => toSelect(r.facility.unique_id)} />
          ))}
          {(inside.length > shown.length || more > 0) && (
            <div className="flex gap-2">
              {inside.length > shown.length && (
                <SecondaryButton className="flex-1" onClick={() => setMore(more + 1)}>Show more ({inside.length - shown.length} left)</SecondaryButton>
              )}
              {more > 0 && <SecondaryButton className="flex-1" onClick={() => setMore(Math.max(0, more - 1))}>Show less</SecondaryButton>}
            </div>
          )}
          {outside.length > 0 && shown.length < inside.length && (
            <p className="text-[14px] text-[var(--hc-muted)]">{outside.length} strong {outside.length === 1 ? 'match is' : 'matches are'} just beyond {d(radiusKm)}: grey pins {letter(0)}{outside.length > 1 ? `–${letter(outside.length - 1)}` : ''} on the map. They are listed after the places inside your radius.</p>
          )}
          {/* Places beyond the radius are listed only after the whole in-radius list, so they never jump ahead of unseen closer options. */}
          {outside.length > 0 && shown.length >= inside.length && (
            <>
              <h2 className="text-[18px] font-bold">Outside your radius</h2>
              <p className="-mt-2 text-[14px] text-[var(--hc-muted)]">Places beyond {d(radiusKm)} that still score {Math.round(bar)} or more, close to the best inside your radius, nearest first. Letters, not ranks. Other places beyond the radius are small grey dots on the map.</p>
              <ul className="flex flex-col gap-2">
                {outside.map((r, i) => (
                  <li key={r.facility.unique_id}>
                    <OutsideRow r={r} num={letter(i)} unit={unit} reason={outsideReason(r, inside, radiusKm, unit)} onOpen={() => toSelect(r.facility.unique_id)} />
                  </li>
                ))}
              </ul>
            </>
          )}
          {weak.length > 0 && (
            <>
              <button type="button" aria-expanded={showWeak} onClick={() => setShowWeak(!showWeak)} className="inline-flex min-h-11 items-center gap-1 self-start text-[15px] font-semibold text-[var(--hc-primary)] underline underline-offset-2">
                Show {weak.length} {weak.length === 1 ? 'place' : 'places'} with little or no evidence for this care<ChevronDown className={`h-4 w-4 transition-transform${showWeak ? ' rotate-180' : ''}`} aria-hidden />
              </button>
              {showWeak && (
                <ul className="flex flex-col gap-2">
                  {weak.map((r) => <li key={r.facility.unique_id}><OutsideRow r={r} num={null} unit={unit} onOpen={() => toSelect(r.facility.unique_id)} /></li>)}
                </ul>
              )}
            </>
          )}
          <ShareBar />
        </>
      }
    />
  );
}

export function ResultsScreen() {
  const { s } = useFlow();
  const bbox = useMemo(() => (s.place ? coarseBBox(s.place, FETCH_RADIUS_KM) : null), [s.place]);
  if (!bbox) return null;
  if (DATA_SOURCE === 'engine_clean') return <EngineResults />;
  return <Candidates bbox={bbox} service={s.intent === 'service' ? requiredService(s.service) : ''}>{(l) => <ResultsBody facilities={l.rows} loading={l.loading} error={l.error} warming={l.warming} sample={l.sample} />}</Candidates>;
}


/**
 * Starts the facility searches as soon as a place is chosen (on the symptoms step), so
 * Results usually opens with data already loaded. The query only needs the place: symptoms,
 * age and sex never leave the browser. Uses the exact same parameters as Results, so AppKit
 * shares one request; while this stays mounted the result is kept for Results to pick up.
 */
export function PrefetchForPlace() {
  const { s } = useFlow();
  const bbox = useMemo(() => (s.place ? coarseBBox(s.place, FETCH_RADIUS_KM) : null), [s.place]);
  if (!bbox) return null;
  if (DATA_SOURCE === 'engine_clean') return <EngineCandidates bbox={bbox}>{() => null}</EngineCandidates>;
  return <Candidates bbox={bbox}>{() => null}</Candidates>;
}
