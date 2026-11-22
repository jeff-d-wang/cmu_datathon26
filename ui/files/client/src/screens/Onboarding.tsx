import { useMemo } from 'react';
import { Phone, MapPin, ClipboardList } from 'lucide-react';
import { useFlow } from '../flow/context';
import type { FlowState, Intent } from '../flow/state';
import { useT } from '../i18n';
import { parseAge } from '../domain/redflags';
import { Shell } from '../components/Shell';
import { IntroPanel } from '../components/MapPanel';
import { Bubble, Chip, LinkButton, Notice, OptionCard, PrimaryButton, ScreenTitle, StepHeader, titleCase } from '../components/ui';
import type { StringKey } from '../i18n/en';
import { Candidates } from '../data/source';
import { coarseBBox, FETCH_RADIUS_KM, formatDistance } from '../domain/geo';
import { FETCH_LIMIT } from './Results';

const INTENTS: { id: Intent; title: StringKey; sub: StringKey; Icon: typeof Phone }[] = [
  { id: 'now', title: 'intent_now', sub: 'intent_now_sub', Icon: Phone },
  { id: 'soon', title: 'intent_soon', sub: 'intent_soon_sub', Icon: MapPin },
  { id: 'surgery', title: 'intent_surgery', sub: 'intent_surgery_sub', Icon: ClipboardList },
];

export function IntentScreen() {
  const { s, dispatch } = useFlow();
  const t = useT();
  const choose = (id: Intent) => {
    if (id === 'now') {
      // One click: "Help right now" goes straight to the Emergency screen.
      dispatch({ type: 'set', patch: { intent: 'now' } });
      dispatch({ type: 'emergency' });
      return;
    }
    dispatch({ type: 'set', patch: { intent: id } });
  };
  const next = () => dispatch({ type: 'go', screen: 'who' });
  return (
    <Shell
      left={<IntroPanel note={t('map_intro')} />}
      right={
        <>
          <StepHeader step={2} />
          <ScreenTitle>{t('intent_title')}</ScreenTitle>
          <div className="flex flex-col gap-2" role="radiogroup" aria-label={t('intent_title')}>
            {INTENTS.map(({ id, title, sub, Icon }) => (
              <OptionCard key={id} selected={s.intent === id} onClick={() => choose(id)} title={t(title)} sub={t(sub)} icon={<Icon className="h-[26px] w-[26px]" />} danger={id === 'now'} />
            ))}
          </div>
          <p className="text-[15px] text-[var(--hc-muted)]">
            <strong>{t('why_we_ask')}</strong> {t('intent_why')}
          </p>
          <PrimaryButton disabled={!s.intent || s.intent === 'now'} onClick={next}>
            {s.intent && s.intent !== 'now' ? t('continue') : t('choose_to_continue')}
          </PrimaryButton>
        </>
      }
    />
  );
}

const GENERIC_NOTE = 'Your answers narrow down the places near you to the ones that fit.';

/** Count comes from the shared, already-cached candidates query (same bbox as Results). */
function PlaceCountPanel() {
  const { s } = useFlow();
  const bbox = useMemo(() => (s.place ? coarseBBox(s.place, FETCH_RADIUS_KM) : null), [s.place]);
  if (!s.place || !bbox) return <IntroPanel note={GENERIC_NOTE} />;
  const place = [s.place.district, s.place.state].filter(Boolean).map(titleCase).join(', ');
  return (
    <Candidates bbox={bbox}>
      {(l) => {
        const n = l.rows.length;
        const note = l.loading || l.error || l.warming || n === 0 ? GENERIC_NOTE
          : `${n >= FETCH_LIMIT ? `${FETCH_LIMIT}+` : n} places within ${formatDistance(FETCH_RADIUS_KM, s.unit)} of ${place} mention health care. Your answers narrow them down to the ones that fit.`;
        return <IntroPanel note={note} />;
      }}
    </Candidates>
  );
}

export function WhoScreen() {
  const { s, dispatch } = useFlow();
  const t = useT();
  const age = parseAge(s.ageRaw);
  const set = (patch: Partial<FlowState>) => dispatch({ type: 'set', patch });
  const conds: { key: keyof typeof s.conditions; label: StringKey }[] = [
    { key: 'pregnant', label: 'cond_pregnant' },
    { key: 'kidney', label: 'cond_kidney' },
    { key: 'stroke', label: 'cond_stroke' },
    { key: 'diabetes', label: 'cond_diabetes' },
  ];
  return (
    <Shell
      left={<PlaceCountPanel />}
      right={
        <>
          <StepHeader step={3} />
          <Bubble>{t('details_intro')}</Bubble>
          <ScreenTitle>{t('who_title')}</ScreenTitle>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t('who_title')}>
            <OptionCard selected={s.forSelf === true} onClick={() => set({ forSelf: true })} title={t('i_am_patient')} />
            <OptionCard selected={s.forSelf === false} onClick={() => set({ forSelf: false })} title={t('someone_else')} />
          </div>
          <div>
            <label htmlFor="age" className="block text-[16px] font-semibold">{t('age_label')}</label>
            <input
              id="age"
              inputMode="numeric"
              autoComplete="off"
              value={s.ageRaw}
              onChange={(e) => set({ ageRaw: e.target.value })}
              aria-invalid={!age.ok}
              aria-describedby="age-help"
              className="mt-1 min-h-12 w-[110px] rounded-[var(--hc-r-control)] border-[1.5px] border-[var(--hc-control)] px-3 text-[18px] font-semibold"
            />
            <p id="age-help" className="mt-1 text-[15px] text-[var(--hc-muted)]">{age.ok ? t('age_help') : t('age_error')}</p>
            {age.ok && age.age !== null && age.age < 18 && <Notice status="info">{t('child_note')}</Notice>}
          </div>
          <fieldset>
            <legend className="text-[16px] font-semibold">{t('sex')}</legend>
            <div className="mt-1 grid grid-cols-2 gap-2" role="radiogroup" aria-label={t('sex')}>
              {(['woman', 'man', 'other'] as const).map((v) => (
                <div key={v} className={v === 'other' ? 'col-span-2' : ''}>
                  <OptionCard selected={s.sex === v} onClick={() => set({ sex: v })} title={t(v === 'other' ? 'sex_other' : v)} />
                </div>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="text-[16px] font-semibold">{t('conditions_title')}</legend>
            <div className="mt-1 flex flex-wrap gap-2">
              {conds.map((c) => (
                <Chip key={c.key} on={s.conditions[c.key]} onClick={() => set({ conditions: { ...s.conditions, [c.key]: !s.conditions[c.key] } })}>
                  {t(c.label)}
                </Chip>
              ))}
            </div>
          </fieldset>
          <p className="text-[15px] text-[var(--hc-muted)]">
            <strong>{t('why_we_ask')}</strong> {t('who_why')}
          </p>
          <PrimaryButton disabled={!age.ok} onClick={() => dispatch({ type: 'go', screen: 'symptoms' })}>{t('continue')}</PrimaryButton>
          <LinkButton className="self-start" onClick={() => dispatch({ type: 'go', screen: 'symptoms' })}>{t('skip')}</LinkButton>
        </>
      }
    />
  );
}
