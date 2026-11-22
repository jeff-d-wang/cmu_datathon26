import { Info } from 'lucide-react';
import { useFlow } from '../flow/context';
import type { FlowState } from '../flow/state';
import { useT } from '../i18n';
import { formatDistance, type Point } from '../domain/geo';
import { Shell } from '../components/Shell';
import { StreetMap } from '../components/StreetMap';
import { CallLink, LinkButton, Notice, ScreenTitle, Section, SkeletonCards, titleCase } from '../components/ui';
import { ScoreMeter } from './parts';
import { distanceFactor, type EngineEntry, type EngineResult } from '../engine/contract';
import { SERVICE_IDS } from '../engine/method';
import { clean, isPresent } from '../engine/present';
import { CALL_CLS, EntryProvider, GRADE, evidenceText, joinPresent, svc, tier } from './EngineResults';

const webHref = (w: string) => (/^https?:/i.test(w) ? w : `https://${w}`);

function DetailBody({ r, entry }: { r: EngineResult; entry: EngineEntry }) {
  const { s, dispatch } = useFlow();
  const t = useT();
  const origin = s.place as Point;
  const phone = clean(r.phone);
  const website = clean(r.website);
  const hasCoords = r.lat !== undefined && r.lon !== undefined && Number.isFinite(r.lat) && Number.isFinite(r.lon);
  const cap = r.capacity !== null && r.capacity !== undefined && isPresent(r.capacity) ? r.capacity : null;
  const ordered = [...entry.needs.map(([x]) => x), ...SERVICE_IDS.filter((x) => !entry.needs.some(([n]) => n === x))];
  const subtitle = joinPresent(clean(r.type) ? titleCase(r.type) : null, r.city, clean(r.state) ? titleCase(r.state ?? '') : null);
  const reasons = r.confidence_reasons.filter(isPresent);
  const osm = hasCoords ? `https://www.openstreetmap.org/directions?to=${r.lat}%2C${r.lon}` : null;
  const linkCls = 'whitespace-nowrap grid min-h-11 place-items-center rounded-[var(--hc-r-control)] border-[1.5px] border-[var(--hc-primary)] bg-white px-4 text-[16px] font-semibold text-[var(--hc-primary)]';
  return (
    <Shell
      footer={t('not_advice')}
      left={<StreetMap origin={origin} ariaLabel={`Map: ${r.name}`} youLabel={t('you')} points={hasCoords ? [{ id: r.facility_id, lat: r.lat as number, lon: r.lon as number, label: '•', name: r.name }] : []} selectedId={r.facility_id} />}
      right={
        <>
          <LinkButton className="self-start" onClick={() => dispatch({ type: 'set', patch: { screen: 'results' } as Partial<FlowState> })}>Back to results</LinkButton>
          <ScreenTitle>{r.name}</ScreenTitle>
          <p className="text-[15px] tabular-nums text-[var(--hc-muted)]">{[subtitle, clean(r.pin) ? `PIN ${r.pin}` : null, `${formatDistance(r.km, s.unit)}`, cap !== null ? `Capacity ${cap}` : null].filter(Boolean).join(' · ')}</p>
          <div className="grid grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2">
            {phone && <CallLink number={phone} placeName={r.name} label={`Call ${phone}`} className={`${CALL_CLS} whitespace-nowrap px-3 tabular-nums`} />}
            {website && <a href={webHref(website)} target="_blank" rel="noreferrer noopener" className={linkCls}>Website ↗</a>}
            {osm && <a href={osm} target="_blank" rel="noreferrer noopener" className={linkCls}>Directions ↗</a>}
          </div>
          {osm && <p className="text-[15px] text-[var(--hc-muted)]">Directions opens OpenStreetMap, a third-party site, in a new tab (it receives the destination).</p>}
          <Section>
            <div className="flex flex-col gap-2">
              <ScoreMeter score={r.score * 100} lo={r.score * 100} hi={r.score * 100} confidence={tier(r.confidence)} rangeText="Score, not a probability" />
              {reasons.length > 0 && <ul className="list-disc pl-5 text-[15px]">{reasons.map((x) => <li key={x}>{x}</li>)}</ul>}
              <p className="text-[15px] tabular-nums">match {r.match.toFixed(2)} × relevance {r.relevance.toFixed(2)}{clean(r.relevance_reason) ? ` (${r.relevance_reason})` : ''} × distance {distanceFactor(r.km, entry.tolerance_km).toFixed(2)} × trust {r.trust.toFixed(2)} = {r.score.toFixed(2)}</p>
            </div>
          </Section>
          {r.location_flags.filter(isPresent).length > 0 && (
            <Section title="Trust and location flags">
              {r.location_flags.filter(isPresent).map((f) => <p key={f} className="mb-1 rounded bg-[var(--hc-warn-bg)] px-2 py-1 text-[var(--hc-warn-text)]">{f}</p>)}
            </Section>
          )}
          <Section title="What the record lists">
            <ul className="flex flex-col gap-2 text-[15px]">
              {ordered.map((id) => {
                const q = clean(r.evidence[id]);
                const grade = GRADE[r.evidence_status?.[id] ?? ''];
                const need = entry.needs.find(([n]) => n === id);
                return (
                  <li key={id} className="border-b border-[#e7eae8] pb-2">
                    <span className="font-semibold">{svc(id)}</span>
                    {need && need[1] >= 0.1 && <span className="text-[var(--hc-muted)]"> ({need[1] >= 0.5 ? 'needed in most similar visits' : 'sometimes needed'})</span>}
                    {q && grade ? (
                      <p className="text-[14px]">Evidence: {grade}. Source field: {r.evidence_status?.[id] === 'structured_field' ? 'type and capacity' : r.evidence_status?.[id] === 'tag_only' ? 'specialty tags' : 'text fields'}. “{evidenceText(q)}”</p>
                    ) : (
                      <p className="flex items-start gap-1.5 text-[14px] text-[var(--hc-muted)]"><Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />not found in the record (lists are cut at 50 items, so it may still exist)</p>
                    )}
                  </li>
                );
              })}
            </ul>
          </Section>
        </>
      }
    />
  );
}

export function EngineDetail() {
  const { s } = useFlow();
  return (
    <EntryProvider>
      {(entry, status) =>
        status === 'loading' ? <div className="p-6"><SkeletonCards n={1} label="Loading place" /></div>
        : (() => {
          const r = entry?.results.find((x) => x.facility_id === s.selectedId);
          return entry && r ? <DetailBody r={r} entry={entry} /> : <div className="p-6"><Notice status="unknown">This place is not in the current results.</Notice></div>;
        })()
      }
    </EntryProvider>
  );
}
