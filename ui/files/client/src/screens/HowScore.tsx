import { useFlow } from '../flow/context';
import { useT } from '../i18n';
import { Shell } from '../components/Shell';
import { IntroPanel } from '../components/MapPanel';
import { LinkButton, ScreenTitle } from '../components/ui';
import { APPROX_LOCATION_KM, COMPONENT_ORDER, DISTANCE_HALF_KM, SCORE_POSITION, WEIGHTS, type ComponentId } from '../domain/score';

/** Plain-words names and explanations for each score component (shared with the results cards). */
export const COMPONENT_TEXT: Record<ComponentId, { name: string; explain: string }> = {
  treatment: { name: 'Treatment match', explain: 'Does it list the services you are likely to need? A service named in two or more places in the record, or backed by matching equipment, counts fully; named once counts a little less; a bare "cardiology" tag counts only towards the upper end of the range.' },
  procedures: { name: 'Procedures it carries out', explain: 'The specific heart procedures listed: angiography, angioplasty and stents, bypass, valve surgery, pacemaker.' },
  equipment: { name: 'Right equipment', explain: 'Equipment that those treatments need, such as a cath lab for angiography, or a ventilator, monitor and defibrillator for intensive care. We flag a service claimed without its equipment.' },
  emergency: { name: 'Emergency readiness', explain: 'Emergency care, ambulance and 24/7 claims, and whether anything else in the record supports the claim (an ambulance or intensive-care equipment).' },
  reputation: { name: 'Reputation signals', explain: 'Self-reported web signals, not patient ratings: NABH accreditation mentioned, a source other than a directory, its own website. We never invent ratings.' },
  distance: { name: 'Distance', explain: 'Straight-line distance. Road distance is longer. When a place only has its PIN-code centre as a location, the range is widened.' },
  accommodate: { name: 'Can they look after this patient', explain: "Children's care for under-18s, maternity and newborn care in pregnancy, dialysis for kidney disease, neurology for a past stroke, diabetes care. These only add points; they never hide a place." },
  quality: { name: 'Data quality', explain: 'Points off for lists cut at 50 items, an approximate location, or signs that the record mixes several branches.' },
};

export function HowScoreScreen() {
  const { dispatch } = useFlow();
  const t = useT();
  const back = () => dispatch({ type: 'go', screen: 'results' });
  return (
    <Shell
      left={<IntroPanel note="Every number on a result card comes from the evidence listed under it. Nothing is hidden." />}
      right={
        <>
          <LinkButton className="self-start" onClick={back}>← Back to results</LinkButton>
          <ScreenTitle>How we score</ScreenTitle>
          <p className="text-[16px]">
            Each place gets a <strong>match score from 0 to 100</strong> and a <strong>score range</strong>, for example &quot;72 (58–85)&quot;.
          </p>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-[16px]">
            <li>The <strong>low end</strong> counts only what the record actually lists.</li>
            <li>The <strong>high end</strong> also counts what may exist but we cannot see: lists in our data are cut at 50 items, some places only say &quot;cardiology&quot;, and many never list equipment. Unknown is treated as &quot;possibly there&quot;, never as missing.</li>
            <li>The <strong>score</strong> sits between them ({Math.round(SCORE_POSITION * 100) / 10} tenths of the way up from the low end).</li>
            <li>The range is wide when we do not know much about a place. It is <strong>not</strong> a statistical confidence interval.</li>
            <li><strong>Confidence</strong> (High, Medium, Low) comes from how wide the range is and how many independent fields back the match.</li>
          </ul>

          <section className="rounded-[var(--hc-r-card)] border-[1.5px] border-[var(--hc-border)] p-4">
            <h2 className="text-[17px] font-bold">Points for each part</h2>
            <p className="text-[15px] text-[var(--hc-muted)]">The weights change with how urgent the need is. When it is urgent, emergency readiness and distance count most. When it is a planned procedure, procedure evidence counts most.</p>
            <table className="mt-2 w-full text-left text-[15px]">
              <thead>
                <tr className="border-b border-[var(--hc-border)]">
                  <th className="py-1.5 font-semibold">Part</th>
                  <th className="py-1.5 text-right font-semibold">Urgent</th>
                  <th className="py-1.5 text-right font-semibold">Planned</th>
                </tr>
              </thead>
              <tbody>
                {COMPONENT_ORDER.map((id) => (
                  <tr key={id} className="border-b border-[var(--hc-border)] last:border-0">
                    <td className="py-1.5">{COMPONENT_TEXT[id].name}</td>
                    <td className="py-1.5 text-right tabular-nums">{WEIGHTS.urgent[id]}</td>
                    <td className="py-1.5 text-right tabular-nums">{WEIGHTS.planned[id]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="flex flex-col gap-3">
            {COMPONENT_ORDER.map((id) => (
              <div key={id}>
                <h3 className="text-[16px] font-bold">{COMPONENT_TEXT[id].name}</h3>
                <p className="text-[15px]">{COMPONENT_TEXT[id].explain}</p>
              </div>
            ))}
            <p className="text-[15px] text-[var(--hc-muted)]">
              Distance points halve at {DISTANCE_HALF_KM.urgent} km when urgent and {DISTANCE_HALF_KM.planned} km when planned. An approximate location adds ±{APPROX_LOCATION_KM} km to the range.
            </p>
          </section>

          <p className="text-[15px] text-[var(--hc-muted)]">{t('not_advice')} Our data has no patient outcomes, so we never show how often a symptom leads to hospital.</p>
        </>
      }
    />
  );
}
