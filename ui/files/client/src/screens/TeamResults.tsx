import { useMemo, useState } from 'react';
import type { Facility } from '../domain/types';
import type { Need } from '../domain/services';
import { serviceName } from '../domain/services';
import { TeamRankQuery } from '../data/team';
import { bannerText, EMPTY_BANNER, GENERIC_BANNER, GENERIC_NEEDS, teamCompare, teamLadder, UNMET_NOTE, type TeamRow } from '../domain/team';
import { Notice, SecondaryButton, Spinner, titleCase } from '../components/ui';
import { useFlow } from '../flow/context';

const PAGE = 10;
const BAND: Record<string, string> = { high: 'well evidenced', medium: 'some evidence', unverified: 'single mention', low: 'contradicted by size', no_evidence: UNMET_NOTE };
const cls = (c: string | null) => (c ? titleCase(c.replace(/_/g, ' ')) : '');

function List({ rows, needs, byId, onOpen, banners, radiusKm }: {
  rows: TeamRow[]; needs: readonly { service: string; weight: number }[]; byId: Map<string, Facility>;
  onOpen: (id: string) => void; banners: string[]; radiusKm: number;
}) {
  const [more, setMore] = useState(0);
  const shown = rows.slice(0, PAGE * (1 + more));
  const total = needs.reduce((a, x) => a + x.weight, 0);
  return (
    <>
      {banners.map((b) => <Notice key={b} status="info">{bannerText(b)}</Notice>)}
      <p className="text-[15px] text-[var(--hc-muted)]">Within {radiusKm} km · {rows.length} {rows.length === 1 ? 'place' : 'places'}</p>
      <ol className="flex flex-col gap-3">
        {shown.map((r, i) => (
          <li key={r.unique_id} className="flex flex-col gap-2 rounded-[var(--hc-r-card)] border-[1.5px] border-[var(--hc-border)] bg-white p-4">
            <div className="flex items-start gap-3">
              <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--hc-primary)] text-[15px] font-bold text-white">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <h3 className="text-[18px] font-bold leading-snug"><span className="sr-only">{i + 1}. </span>{r.name}</h3>
                <p className="text-[15px] text-[var(--hc-muted)]">{[cls(r.facility_class), `${r.km.toFixed(1)} km`, r.beds !== null ? `${r.beds} beds` : ''].filter(Boolean).join(' · ')}</p>
              </div>
            </div>
            <p className="text-[15px]">
              <span className="font-semibold">Team score {r.score.toFixed(2)} of {total.toFixed(2)}</span> · Meets {r.n_needs_met} of {needs.length} needs
              {r.nabh && <span className="ml-2 rounded-full border border-[var(--hc-border)] px-2 py-0.5 text-[14px] font-medium">NABH</span>}
            </p>
            <ul className="flex flex-col gap-0.5 text-[15px]">
              {needs.map((nd) => <li key={nd.service}><span className="font-medium">{serviceName(nd.service)}</span>: {BAND[r.matched[nd.service] ?? 'no_evidence'] ?? UNMET_NOTE}</li>)}
            </ul>
            {byId.has(r.unique_id) && <SecondaryButton onClick={() => onOpen(r.unique_id)}>Full details</SecondaryButton>}
          </li>
        ))}
      </ol>
      {(rows.length > shown.length || more > 0) && (
        <div className="flex gap-2">
          {rows.length > shown.length && <SecondaryButton className="flex-1" onClick={() => setMore(more + 1)}>Show more ({rows.length - shown.length} left)</SecondaryButton>}
          {more > 0 && <SecondaryButton className="flex-1" onClick={() => setMore(Math.max(0, more - 1))}>Show less</SecondaryButton>}
        </div>
      )}
    </>
  );
}

function Generic({ origin, primary, byId, onOpen }: { origin: { lat: number; lon: number }; primary: string[]; byId: Map<string, Facility>; onOpen: (id: string) => void }) {
  return (
    <TeamRankQuery origin={origin} needs={GENERIC_NEEDS}>
      {(g) => {
        if (g.loading) return <Spinner label="Loading team ranking" />;
        if (g.error) return <Notice status="bad">Could not load the team ranking ({g.error})</Notice>;
        const rows = g.rows.filter((r) => r.km <= 300).sort(teamCompare);
        if (!rows.length) return <>{[...primary, EMPTY_BANNER].map((b) => <Notice key={b} status="info">{bannerText(b)}</Notice>)}</>;
        return <List rows={rows} needs={GENERIC_NEEDS} byId={byId} onOpen={onOpen} banners={[...primary, GENERIC_BANNER]} radiusKm={300} />;
      }}
    </TeamRankQuery>
  );
}

export function TeamResults({ needs, facilities, onOpen }: { needs: readonly Need[]; facilities: Facility[]; onOpen: (id: string) => void; unit: 'km' | 'mi' }) {
  const { s } = useFlow();
  const origin = useMemo(() => ({ lat: s.place?.lat ?? 0, lon: s.place?.lon ?? 0 }), [s.place?.lat, s.place?.lon]);
  const used = useMemo(() => (needs.length ? needs : GENERIC_NEEDS), [needs]);
  const byId = useMemo(() => new Map(facilities.map((f) => [f.unique_id, f])), [facilities]);
  return (
    <>
      <div className="rounded-[var(--hc-r-control)] border-[1.5px] border-[var(--hc-border)] bg-white px-3 py-2 text-[15px]">
        <p className="font-semibold">Team evidence ranking (src/recommend.py)</p>
        <p>Score = sum of need weight × evidence (high 1.0, medium 0.5, unverified 0.3, low 0.05, none 0), × 0.95 when the location is only a PIN-code centre. Ties: NABH, beds, facility type, then distance. Distance only limits the search: 25 → 50 → 100 → 300 km.</p>
      </div>
      <TeamRankQuery origin={origin} needs={used}>
        {(l) => {
          if (l.loading) return <Spinner label="Loading team ranking" />;
          if (l.error) return <Notice status="bad">Could not load the team ranking ({l.error})</Notice>;
          const lad = teamLadder(l.rows);
          if (lad.mode === 'empty') return <Generic origin={origin} primary={lad.banners} byId={byId} onOpen={onOpen} />;
          return <List rows={lad.rows} needs={used} byId={byId} onOpen={onOpen} banners={lad.banners} radiusKm={lad.radiusKm} />;
        }}
      </TeamRankQuery>
    </>
  );
}
