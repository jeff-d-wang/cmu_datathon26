import { useMemo } from 'react';
import { useFlow } from '../flow/context';
import type { FlowState } from '../flow/state';
import { useT } from '../i18n';
import { BAND_LABEL, parseServices, serviceName, type Need } from '../domain/services';
import { coarseBBox, FETCH_RADIUS_KM, formatDistance, type Point } from '../domain/geo';
import { isRelevant, type Ranked } from '../domain/ranking';
import type { Facility } from '../domain/types';
import { Candidates, DATA_SOURCE } from '../data/source';
import { EngineDetail } from './EngineDetail';
import { Shell } from '../components/Shell';
import { StreetMap } from '../components/StreetMap';
import { Clock, Info, MapPin, Phone as PhoneIcon } from 'lucide-react';
import { CallLink, LinkButton, Notice, SampleBadge, ScreenTitle, Section, Spinner, StatusTag, titleCase, type Status } from '../components/ui';
import { useRankedResults } from './Results';
import { HowOrdered, TierTag, WarningList, WhyList } from './parts';

const CENTRAL_LINE_MIN = 10;

function PhoneValue({ number, sharedBy }: { number: string; sharedBy: number }) {
  const t = useT();
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="whitespace-nowrap font-semibold tabular-nums">{number}</span>
      {sharedBy >= CENTRAL_LINE_MIN && (
        <span className="flex items-start gap-1.5 text-[15px] text-[var(--hc-primary-dark)]">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {t('central_line', { n: sharedBy })}
        </span>
      )}
    </span>
  );
}

function DetailBody({ r, rank, total, sample, needs }: { r: Ranked; rank: number | null; total: number; sample: boolean; needs: readonly Need[] }) {
  const { s, dispatch } = useFlow();
  const t = useT();
  const f = r.facility;
  const svcs = parseServices(f.services);
  const set = (patch: Partial<FlowState>) => dispatch({ type: 'set', patch });
  const origin = s.place as Point;
  // Needed services first (band status; a missing need shows as unknown), then ICU/emergency/NABH rows.
  const emergencyClaimed = f.emergency_quote !== '' || f.claims_247 || svcs.has('emergencyCare');
  const rows: { name: string; status: Status; statusText: string; evidence: string }[] = [
    ...needs.slice(0, 8).map((n) => {
      const ev = svcs.get(n.service);
      const good = ev !== undefined && (ev.band === 'high' || ev.band === 'medium');
      return {
        name: serviceName(n.service),
        status: (ev ? (good ? 'ok' : 'warn') : 'unknown') as Status,
        statusText: ev ? (good ? t('st_listed') : t('st_claimed')) : t('st_unknown'),
        evidence: ev ? `${BAND_LABEL[ev.band]} · ${t('mentioned_n', { n: ev.channels || 1 })}` : t('unknown_evidence'),
      };
    }),
    f.icu_quote
      ? { name: t('icu_row'), status: f.icu_equipment ? 'ok' : 'warn', statusText: f.icu_equipment ? t('st_listed') : t('st_claimed'), evidence: f.icu_quote ? `“${f.icu_quote.trim()}”` : '' }
      : { name: t('icu_row'), status: 'unknown', statusText: t('st_unknown'), evidence: t('unknown_evidence') },
    emergencyClaimed
      ? { name: t('emergency_row'), status: f.ambulance || f.icu_equipment ? 'ok' : 'warn', statusText: f.ambulance || f.icu_equipment ? t('st_listed') : t('st_claimed'), evidence: f.emergency_quote ? `“${f.emergency_quote.trim()}”` : '' }
      : { name: t('emergency_row'), status: 'unknown', statusText: t('st_unknown'), evidence: t('unknown_evidence') },
    f.says_nabh
      ? { name: t('nabh_row'), status: 'warn', statusText: t('st_claimed'), evidence: `${t('says_nabh')}${f.nabh_quote ? `: “${f.nabh_quote.trim()}”` : ''}` }
      : { name: t('nabh_row'), status: 'unknown', statusText: t('st_unknown'), evidence: t('unknown_evidence') },
  ];
  const own = t(f.ownership === 'private' ? 'ownership_private' : f.ownership === 'public' ? 'ownership_public' : 'ownership_unknown');
  return (
    <Shell
      footer={t('not_advice')}
      left={<StreetMap origin={origin} ariaLabel={t('map_name', { n: 1, d: formatDistance(r.km, s.unit) })} youLabel={t('you')} points={[{ id: f.unique_id, lat: f.lat, lon: f.lon, label: rank !== null ? String(rank) : '•', name: f.name, warn: r.warnings.length > 0 }]} selectedId={f.unique_id} />}
      right={
        <>
          <LinkButton className="self-start" onClick={() => set({ screen: 'results' })}>{t('back_to_matches', { n: total })}</LinkButton>
          <div className="flex flex-wrap items-center gap-2">
            {rank !== null && <span className="text-[15px] font-semibold text-[var(--hc-muted)]">{t('rank_short', { r: rank, n: total })}</span>}
            <TierTag tier={r.tier} />
            {sample && <SampleBadge />}
          </div>
          <ScreenTitle>{f.name}</ScreenTitle>
          <p className="text-[15px] text-[var(--hc-muted)]">
            {titleCase(f.facility_class)} · {own} · {[f.city, titleCase(f.state)].filter(Boolean).join(', ')} · {t('km_straight', { d: formatDistance(r.km, s.unit) })}
            {f.loc_approx ? ` · ${t('approx_location')}` : ''}
          </p>
          {(f.doctors !== null || f.beds !== null) && <p className="text-[15px]">{[f.doctors !== null ? `${f.doctors} doctors` : null, f.beds !== null ? `${f.beds} beds` : null].filter(Boolean).join(' · ')} (as listed)</p>}
          <div className="flex flex-wrap gap-2 hc-no-print">
            {f.official_phone && <CallLink number={f.official_phone} placeName={f.name} label={`${t('call')} ${f.official_phone}`} className="flex min-h-[46px] items-center justify-center rounded-[var(--hc-r-control)] bg-[var(--hc-primary)] px-4 text-[16px] font-semibold text-white" />}
            <a href={`https://www.google.com/maps/dir/?api=1&destination=${f.lat},${f.lon}`} target="_blank" rel="noreferrer noopener" title={t('directions_note')} className="grid min-h-[46px] place-items-center rounded-[var(--hc-r-control)] border-[1.5px] border-[var(--hc-primary)] bg-white px-4 text-[16px] font-semibold text-[var(--hc-primary)]">{t('directions')} ↗</a>
            {f.website && <a href={f.website.startsWith('http') ? f.website : `https://${f.website}`} target="_blank" rel="noreferrer noopener" className="grid min-h-[46px] place-items-center rounded-[var(--hc-r-control)] border-[1.5px] border-[var(--hc-primary)] bg-white px-4 text-[16px] font-semibold text-[var(--hc-primary)]">{t('website')} ↗</a>}
          </div>
          <p className="text-[15px] text-[var(--hc-muted)]">{t('directions_note')}</p>

          <Section title={rank !== null ? t('why_listed', { r: rank }) : 'Why it was found'}>
            <p className="mb-1 text-[15px] text-[var(--hc-muted)]">{t('why_listed_sub')}</p>
            <WhyList r={r} unit={s.unit} />
            <div className="mt-1"><HowOrdered mode={r.mode} /></div>
            <div className="mt-2"><WarningList warnings={r.warnings} /></div>
          </Section>

          <Section title={t('lists_title')}>
            <table className="w-full text-left text-[15px]">
              <thead>
                <tr className="border-b border-[#e7eae8] text-[14px] text-[var(--hc-muted)]">
                  <th className="py-1 pr-2 font-semibold">{t('col_service')}</th>
                  <th className="py-1 pr-2 font-semibold">{t('col_status')}</th>
                  <th className="py-1 font-semibold">{t('col_evidence')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.name} className="border-b border-[#e7eae8] align-top">
                    <td className="py-1.5 pr-2 font-medium">{row.name}</td>
                    <td className="py-1.5 pr-2"><StatusTag status={row.status}>{row.statusText}</StatusTag></td>
                    <td className="py-1.5 text-[14px]">{row.evidence}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {f.list_truncated && <p className="mt-2 flex items-start gap-1.5 text-[15px] text-[var(--hc-muted)]"><Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{t('data_note_truncated')}</p>}
          </Section>

          <Section title={t('ask_title')}>
            <ul className="list-disc space-y-1 pl-5 text-[15px]">
              {(['ask_1', 'ask_2', 'ask_3', 'ask_4', 'ask_5'] as const).map((k) => <li key={k}>{t(k)}</li>)}
            </ul>
          </Section>

          <Section title={t('contact')}>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-4 gap-y-2 text-[16px]">
              <dt className="flex items-center gap-1.5 whitespace-nowrap font-semibold"><PhoneIcon className="h-4 w-4" aria-hidden />{t('phone_main')}</dt>
              <dd>
                {f.official_phone ? <PhoneValue number={f.official_phone} sharedBy={f.official_phone_shared_by} /> : <span className="text-[var(--hc-muted)]">{t('no_phone')}</span>}
              </dd>
              {f.alt_phone && (
                <>
                  <dt className="flex items-center gap-1.5 whitespace-nowrap font-semibold"><PhoneIcon className="h-4 w-4" aria-hidden />{t('phone_other')}</dt>
                  <dd><PhoneValue number={f.alt_phone} sharedBy={0} /></dd>
                </>
              )}
              <dt className="flex items-center gap-1.5 whitespace-nowrap font-semibold"><MapPin className="h-4 w-4" aria-hidden />{t('address')}</dt>
              <dd className="break-words">{[f.address, f.city, titleCase(f.district), titleCase(f.state), f.pin].filter(Boolean).join(', ')}</dd>
              <dt className="flex items-center gap-1.5 whitespace-nowrap font-semibold"><Clock className="h-4 w-4" aria-hidden />{t('hours_label')}</dt>
              <dd className="text-[var(--hc-muted)]">{t('hours')}</dd>
            </dl>
          </Section>

          <Section title={t('payment_title')}>
            <p className="text-[15px]">{t('payment_text')}</p>
          </Section>
        </>
      }
    />
  );
}

function DetailFromData({ facilities, loading, sample }: { facilities: Facility[]; loading: boolean; sample: boolean }) {
  const { s } = useFlow();
  const t = useT();
  const { ranked, needs, radiusKm } = useRankedResults(s, facilities);
  // Same list as the results page: places inside the radius with evidence (tier A/B), in ranked order.
  const listed = ranked.filter((r) => r.km <= radiusKm && isRelevant(r));
  // Any loaded place can be opened (the list, map dots, outside-radius and weak places), not only the first few.
  const r = ranked.find((x) => x.facility.unique_id === s.selectedId);
  if (loading) return <div className="p-6"><Spinner label={t('loading_results')} /></div>;
  if (!r) return <div className="p-6"><Notice status="unknown">{t('no_results')}</Notice></div>;
  const idx = listed.indexOf(r);
  return <DetailBody r={r} rank={idx >= 0 ? idx + 1 : null} total={listed.length} sample={sample} needs={needs} />;
}

export function DetailScreen() {
  const { s } = useFlow();
  const bbox = useMemo(() => (s.place ? coarseBBox(s.place, FETCH_RADIUS_KM) : null), [s.place]);
  if (!bbox) return null;
  if (DATA_SOURCE === 'engine_clean') return <EngineDetail />;
  return <Candidates bbox={bbox}>{(l) => <DetailFromData facilities={l.rows} loading={l.loading} sample={l.sample} />}</Candidates>;
}
