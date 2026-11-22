import { DistrictRatingQuery } from '../data/district';
import { titleCase } from '../components/ui';

export function DistrictPanel({ state, district }: { state: string; district: string }) {
  return (
    <DistrictRatingQuery state={state} district={district}>
      {(r) => {
        if (!r) return null;
        const score = (v: number | null) => (v === null ? null : `${Math.round(v)}/100`);
        const rows: [string, string | null][] = [
          ['Facilities in our data', r.n_facilities === null ? null : String(r.n_facilities)],
          ['Doctors per facility (as listed)', r.doctors_per_fac === null ? null : String(Math.round(r.doctors_per_fac * 10) / 10)],
          ['Critical services covered', r.critical_cov === null ? null : `${Math.round(r.critical_cov * 100)}%`],
          ['Maternal care', score(r.score_maternal)],
          ['Immunisation', score(r.score_immunisation)],
          ['Chronic disease (NCD)', score(r.score_ncd)],
          ['Access', score(r.score_access)],
        ];
        const shown = rows.filter((x): x is [string, string] => x[1] !== null);
        return (
          <section aria-labelledby="district-title" className="rounded-[var(--hc-r-control)] border-[1.5px] border-[var(--hc-border)] bg-white px-3 py-2">
            <h2 id="district-title" className="text-[17px] font-bold">About {titleCase(r.district_name)} district</h2>
            {r.band_equal && (
              <p className="mt-1 text-[15px]">
                District health rating: band {r.band_equal} of A–E
                {r.composite !== null && r.n_districts !== null
                  ? ` (composite ${Math.round(r.composite)}/100; A is the best fifth of ${r.n_districts} districts)`
                  : ''}
              </p>
            )}
            {r.access_status === 'no_facilities' && <p className="mt-1 text-[15px]">No facilities from our data are matched to this district.</p>}
            {shown.length > 0 && (
              <dl className="mt-1 flex flex-col gap-1 text-[15px]">
                {shown.map(([k, v]) => (
                  <div key={k} className="flex items-baseline gap-2">
                    <dt className="w-52 shrink-0 font-semibold">{k}</dt>
                    <dd className="min-w-0 flex-1 text-[var(--hc-text-2)]">{v}</dd>
                  </div>
                ))}
              </dl>
            )}
            <p className="mt-1 text-[13px] text-[var(--hc-muted)]">Team rating from the NFHS-5 district survey and facility data. It describes the district, not any single place.</p>
          </section>
        );
      }}
    </DistrictRatingQuery>
  );
}
