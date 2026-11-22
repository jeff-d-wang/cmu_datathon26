import { useMemo, useRef, useState } from 'react';
import { Check, MapPin, X } from 'lucide-react';
import { useFlow } from '../flow/context';
import type { FlowState, Ownership } from '../flow/state';
import { symptomLabel, useT } from '../i18n';
import type { StringKey } from '../i18n/en';
import { checkRedFlags, isHardFlag, parseAge, redFlagWordsIn, type SafetyChecks } from '../domain/redflags';
import { detectSymptoms, isOwnWords, normalise, OWN_PREFIX, ownWordsText, QUICK_PICK_IDS, suggestSymptoms } from '../domain/symptoms';
import { requestById } from '../domain/requests';
import { placeLabel, placeTowns, searchPlaces, type Place } from '../domain/places';
import { Candidates, Places, States } from '../data/source';
import { coarseBBox, FETCH_RADIUS_KM } from '../domain/geo';
import { Shell } from '../components/Shell';
import { IntroPanel } from '../components/MapPanel';
import { AnswerSummary, Bubble, Chip, Notice, PrimaryButton, SampleBadge, ScreenTitle, Spinner, StepHeader, titleCase } from '../components/ui';

const SAFETY: { key: keyof SafetyChecks; label: StringKey }[] = [
  { key: 'painAtRestOr15Min', label: 'safety_rest' },
  { key: 'sweatingNauseaFaint', label: 'safety_sweat' },
  { key: 'breathlessAtRest', label: 'safety_breath' },
  { key: 'jawArmBackPain', label: 'safety_jaw' },
];

function PlaceSearch({ places, onPick, onClear, chosen }: { places: Place[]; onPick: (p: Place) => void; onClear: () => void; chosen: Place | null }) {
  const t = useT();
  const [q, setQ] = useState(chosen ? placeLabel(chosen) : '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const editing = !chosen || q !== placeLabel(chosen);
  const hits = useMemo(() => (editing ? searchPlaces(places, q) : []), [places, q, editing]);
  const showList = open && q.trim().length >= 2 && editing;
  const pick = (p: Place) => {
    onPick(p);
    setQ(placeLabel(p));
    setOpen(false);
    inputRef.current?.focus();
  };
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showList || hits.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % hits.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + hits.length) % hits.length); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(hits[active]); }
    else if (e.key === 'Escape') { setOpen(false); }
  };
  return (
    <div className="relative">
      <label htmlFor="place" className="block text-[16px] font-semibold">{t('place_label')}</label>
      <div className="relative mt-1">
        <MapPin className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[var(--hc-muted)]" aria-hidden />
        <input
          id="place"
          ref={inputRef}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls="place-list"
          aria-activedescendant={showList && hits[active] ? `place-opt-${active}` : undefined}
          autoComplete="off"
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKey}
          placeholder={t('place_placeholder')}
          className={`min-h-12 w-full rounded-[var(--hc-r-control)] border-[1.5px] bg-white pl-10 pr-11 text-[16px] ${chosen && !editing ? 'border-[var(--hc-primary)] font-semibold text-[var(--hc-primary-dark)]' : 'border-[var(--hc-control)]'}`}
        />
        {q && (
          <button type="button" aria-label={t('clear_place')} onClick={() => { setQ(''); onClear(); inputRef.current?.focus(); }} className="absolute right-1.5 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-lg text-[var(--hc-muted)] hover:bg-[var(--hc-bg)]">
            <X className="h-5 w-5" aria-hidden />
          </button>
        )}
        {showList && (
          <ul id="place-list" role="listbox" aria-label={t('place_label')} className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-[var(--hc-r-control)] border-[1.5px] border-[var(--hc-border)] bg-white py-1 shadow-[0_8px_24px_rgb(23_33_31/0.12)]">
            {hits.length === 0 && <li role="presentation" className="px-3 py-2 text-[15px] text-[var(--hc-muted)]">{t('place_none')}</li>}
            {hits.map((p, i) => (
              <li
                key={`${p.kind}-${p.code}-${p.district}`}
                id={`place-opt-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => { e.preventDefault(); pick(p); }}
                onMouseEnter={() => setActive(i)}
                className={`flex min-h-11 cursor-pointer items-center gap-2 px-3 text-[16px] ${i === active ? 'bg-[var(--hc-tint)] text-[var(--hc-primary-dark)]' : ''}`}
              >
                <span className="flex-1 py-1.5">
                  {placeLabel(p)}
                  {placeTowns(p) && <span className="block text-[14px] text-[var(--hc-muted)]">{placeTowns(p)}</span>}
                </span>
                <span className="text-[14px] text-[var(--hc-muted)]">{p.kind === 'pin' ? 'PIN' : t('district_word')}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p role="status" className="sr-only">{showList ? (hits.length === 0 ? t('place_none') : t('places_found', { n: hits.length })) : ''}</p>
    </div>
  );
}

/** Opt-in device location. Never requested automatically; the position never leaves the browser (only a 0.5° box is queried). */
function UseMyLocation({ onPlace }: { onPlace: (p: Place) => void }) {
  const t = useT();
  const [status, setStatus] = useState<'idle' | 'busy' | 'denied'>('idle');
  const go = () => {
    if (!('geolocation' in navigator)) return setStatus('denied');
    setStatus('busy');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setStatus('idle');
        const round = (v: number) => Math.round(v * 100) / 100;
        onPlace({ kind: 'gps', code: '', district: t('your_location'), state: '', towns: '', lat: round(pos.coords.latitude), lon: round(pos.coords.longitude) });
      },
      () => setStatus('denied'),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 },
    );
  };
  return (
    <div>
      <button type="button" onClick={go} className="inline-flex min-h-11 items-center gap-2 rounded-[var(--hc-r-control)] border-[1.5px] border-[var(--hc-primary)] bg-white px-4 text-[16px] font-semibold text-[var(--hc-primary)] hover:bg-[var(--hc-tint)]">
        <MapPin className="h-5 w-5" aria-hidden />
        {t('use_location')}
      </button>
      <p className="mt-1 text-[15px] text-[var(--hc-muted)]">{t('use_location_note')}</p>
      <p role="status" className="text-[15px]">{status === 'busy' ? t('locating') : status === 'denied' ? t('location_denied') : ''}</p>
    </div>
  );
}

/**
 * Symptom typeahead (ARIA combobox). Typing suggests symptoms from config/symptom_map.json,
 * including everyday and Hinglish phrases. Picking one adds it as a chip. Anything typed but
 * not picked is still read by the keyword rules and red flags. Never leaves the browser.
 */
function SymptomSearch({ text, onText, picked, onPick, onRemove }: { text: string; onText: (v: string) => void; picked: string[]; onPick: (id: string) => void; onRemove: (id: string) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const labelFor = (id: string) => symptomLabel(t, id);
  const hits = suggestSymptoms(text, labelFor, picked);
  const q = text.trim();
  // Anything not in the list can still be added in the user's own words (no dead ends).
  const ownId = OWN_PREFIX + q;
  const offerOwn = q.length >= 2 && !hits.some((h) => normalise(h.label) === normalise(q)) && !picked.includes(ownId);
  const options = [...hits.map((h) => ({ id: h.id, label: h.label, via: h.via, own: false })), ...(offerOwn ? [{ id: ownId, label: t('symptom_add_own', { q }), via: null, own: true }] : [])];
  const showList = open && q.length >= 2;
  const pick = (id: string) => {
    onPick(id);
    setOpen(false);
    setActive(0);
    inputRef.current?.focus();
  };
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && text === '' && picked.length > 0) { onRemove(picked[picked.length - 1]); return; }
    if (!showList || options.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % options.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + options.length) % options.length); }
    else if (e.key === 'Enter' || (e.key === 'Tab' && !options[active]?.own)) { if (options[active]) { e.preventDefault(); pick(options[active].id); } }
    else if (e.key === 'Escape') { setOpen(false); }
  };
  return (
    <div className="relative">
      <label htmlFor="symptoms" className="block text-[16px] font-semibold">{t('describe_label')}</label>
      <div className="mt-1 flex min-h-12 flex-wrap items-center gap-1.5 rounded-[var(--hc-r-control)] border-[1.5px] border-[var(--hc-control)] bg-white px-2 py-1.5 focus-within:border-[var(--hc-primary)] focus-within:ring-2 focus-within:ring-[var(--hc-primary)]/30" onClick={() => inputRef.current?.focus()}>
        {picked.map((id) => (
          <span key={id} className="inline-flex min-h-8 items-center gap-1 rounded-full bg-[var(--hc-tint)] pl-3 pr-1 text-[15px] font-medium text-[var(--hc-primary-dark)]">
            {labelFor(id)}
            <button type="button" aria-label={t('symptom_remove', { s: labelFor(id) })} onClick={(e) => { e.stopPropagation(); onRemove(id); }} className="grid h-7 w-7 place-items-center rounded-full hover:bg-white">
              <X className="h-4 w-4" aria-hidden />
            </button>
          </span>
        ))}
        <input
          id="symptoms"
          ref={inputRef}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls="symptom-list"
          aria-activedescendant={showList && options[active] ? `symptom-opt-${active}` : undefined}
          aria-describedby="symptom-hint"
          autoComplete="off"
          spellCheck={false}
          value={text}
          onChange={(e) => { onText(e.target.value); setOpen(true); setActive(0); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKey}
          placeholder={picked.length ? '' : t('symptom_placeholder')}
          style={{ outline: 'none', boxShadow: 'none' }}
          className="min-h-9 min-w-[12ch] flex-1 border-0 bg-transparent px-1 text-[16px]"
        />
      </div>
      {showList && (
        <ul id="symptom-list" role="listbox" aria-label={t('describe_label')} className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-[var(--hc-r-control)] border-[1.5px] border-[var(--hc-border)] bg-white py-1 shadow-[0_8px_24px_rgb(23_33_31/0.12)]">
          {options.map((h, i) => (
            <li
              key={h.id}
              id={`symptom-opt-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); pick(h.id); }}
              onMouseEnter={() => setActive(i)}
              className={`flex min-h-11 cursor-pointer items-center gap-2 px-3 text-[16px] ${i === active ? 'bg-[var(--hc-tint)] text-[var(--hc-primary-dark)]' : ''}`}
            >
              <span className={`flex-1 ${h.own ? '' : 'font-medium'}`}>{h.label}</span>
              {h.via && <span className="text-[14px] text-[var(--hc-muted)]">{t('symptom_via', { k: h.via })}</span>}
            </li>
          ))}
        </ul>
      )}
      {picked.some(isOwnWords) && <p className="mt-1 text-[15px] text-[var(--hc-muted)]">{t('symptom_own_note')}</p>}
      <p role="status" className="sr-only">{showList ? t('symptoms_found', { n: options.length }) : ''}</p>
    </div>
  );
}

/** Shows that the facility search already started when the place was picked (see PrefetchForPlace). */
function BackgroundSearch({ quiet }: { quiet?: boolean } = {}) {
  const { s } = useFlow();
  const t = useT();
  const bbox = useMemo(() => (s.place ? coarseBBox(s.place, FETCH_RADIUS_KM) : null), [s.place]);
  if (!bbox || !s.place) return null;
  const p = placeLabel(s.place);
  return (
    <Candidates bbox={bbox}>
      {({ loading, error }) => error || (quiet && !loading) ? null : (
        <p role="status" className="-mt-2 flex items-center gap-1.5 text-[15px] text-[var(--hc-muted)]">
          {loading ? t('background_search', { p }) : <><Check className="h-4 w-4 text-[var(--hc-primary)]" aria-hidden />{t('background_ready', { p })}</>}
        </p>
      )}
    </Candidates>
  );
}

export function SymptomsScreen() {
  const { s, dispatch } = useFlow();
  const t = useT();
  const set = (patch: Partial<FlowState>) => dispatch({ type: 'set', patch });
  const age = parseAge(s.ageRaw).age;
  const needText = s.intent === 'service' ? (requestById(s.service ?? '')?.name ?? t('intent_service')) : t('intent_soon');
  const patientText = [s.sex ? t(s.sex === 'other' ? 'sex_other' : s.sex) : null, age !== null ? String(age) : null].filter(Boolean).join(', ') || '—';

  const liveFlags = checkRedFlags({ safety: s.safety, freeText: [s.freeText, ...s.chips.filter(isOwnWords).map(ownWordsText)].join(' '), symptomIds: detectSymptoms(s.freeText, s.chips), age, diabetes: s.conditions.diabetes });
  const softWords = redFlagWordsIn([s.freeText, ...s.chips.filter(isOwnWords).map(ownWordsText)].join(' '));
  const softProfile = liveFlags.reasons.includes('chest_pain_risk_profile');

  /** Everything the user typed: the box plus any symptoms added in their own words. */
  const typed = (chips: string[]) => [s.freeText, ...chips.filter(isOwnWords).map(ownWordsText)].join(' ');

  const submit = () => {
    const symptomIds = detectSymptoms(s.freeText, s.chips);
    const flags = checkRedFlags({ safety: s.safety, freeText: typed(s.chips), symptomIds, age, diabetes: s.conditions.diabetes });
    if (isHardFlag(flags.reasons)) {
      dispatch({ type: 'emergency' });
      return;
    }
    dispatch({ type: 'go', screen: 'results' });
  };

  /** Picking a suggestion clears the box, so check what was typed for red flags first. */
  const pickSymptom = (id: string) => {
    const chips = s.chips.includes(id) ? s.chips : [...s.chips, id];
    const flags = checkRedFlags({ safety: s.safety, freeText: typed(chips), symptomIds: detectSymptoms(s.freeText, chips), age, diabetes: s.conditions.diabetes });
    set({ chips, freeText: '' });
    if (isHardFlag(flags.reasons)) dispatch({ type: 'emergency' });
  };

  return (
    <Shell
      footer={t('not_advice')}
      left={<IntroPanel note={t('radius_auto')} />}
      right={
        <>
          <StepHeader step={4} />
          <ScreenTitle>{t('symptoms_only_heading')}</ScreenTitle>
          <AnswerSummary
            rows={[
              { label: t('need').replace(':', ''), value: needText },
              { label: t('patient').replace(':', ''), value: patientText === '—' ? '' : patientText },
            ]}
            actionLabel={t('change')}
            onAction={() => dispatch({ type: 'go', screen: 'who' })}
          />

          <AnswerSummary
            rows={[{ label: t('place_label'), value: s.place ? placeLabel(s.place) : '' }]}
            actionLabel={t('change')}
            onAction={() => dispatch({ type: 'go', screen: 'place' })}
          />
          <BackgroundSearch quiet />
          <section className="flex flex-col gap-2 rounded-[var(--hc-r-card)] border-2 border-[var(--hc-primary)] p-4">
            <Bubble>{t('describe_prompt')}</Bubble>
            <SymptomSearch
              text={s.freeText}
              onText={(v) => set({ freeText: v })}
              picked={s.chips}
              onPick={pickSymptom}
              onRemove={(id) => dispatch({ type: 'toggle_chip', id })}
            />
            {QUICK_PICK_IDS.some((id) => !s.chips.includes(id)) && (
              <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('quick_picks')}>
                <span className="text-[15px] text-[var(--hc-muted)]">{t('quick_picks')}</span>
                {QUICK_PICK_IDS.filter((id) => !s.chips.includes(id)).map((id) => (
                  <Chip key={id} on={false} onClick={() => dispatch({ type: 'toggle_chip', id })}>
                    {t(`chip_${id}` as StringKey)}
                  </Chip>
                ))}
              </div>
            )}
            <p id="symptom-hint" className="text-[15px] text-[var(--hc-muted)]">{t('describe_hint')}</p>
          </section>

          <fieldset className="rounded-[var(--hc-r-control)] border-[1.5px] border-[var(--hc-em-border)] bg-[#fff8f7] p-3">
            {/* Legend floated inside the box so a long, translated title never sits on the border. */}
            <legend className="float-left mb-2 w-full">
              <span className="block text-[17px] font-bold text-[var(--hc-em-text)]">{t('safety_title')}</span>
              <span className="block text-[15px] text-[var(--hc-em-text)]">{t('safety_sub')}</span>
            </legend>
            <div className="clear-both grid grid-cols-2 gap-2">
              {SAFETY.map(({ key, label }) => (
                <label key={key} className="flex items-start gap-2 text-[15px]">
                  <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--hc-em-btn)]" checked={s.safety[key]} onChange={(e) => {
                      set({ safety: { ...s.safety, [key]: e.target.checked } });
                      // Any tick opens the Emergency screen at once (no facility list).
                      if (e.target.checked) dispatch({ type: 'emergency' });
                    }} />
                  {t(label)}
                </label>
              ))}
            </div>
          </fieldset>
          <section className="flex flex-col gap-2">
            <p className="text-[16px] font-semibold" id="type-label">{t('type_label')}</p>
            <div className="flex flex-wrap items-center gap-2 text-[16px]" role="radiogroup" aria-labelledby="type-label">
              {(['any', 'private', 'public'] as Ownership[]).map((o) => (
                <Chip radio key={o} on={s.ownership === o} onClick={() => set({ ownership: o })}>
                  {t(o === 'any' ? 'type_any' : o === 'private' ? 'type_private' : 'type_public')}
                </Chip>
              ))}
            </div>
          </section>

          {s.place && (softWords.length > 0 || softProfile) && (
            <div role="alert" className="flex flex-col gap-2 rounded-[var(--hc-r-control)] border-[1.5px] border-[var(--hc-em-border)] bg-[#fff8f7] p-3 text-[15px] text-[var(--hc-em-text)]">
              <p className="text-[16px] font-bold">{t('soft_flag_title')}</p>
              {softWords.length > 0 && <p>{t('soft_flag_words', { w: softWords.map((w) => `“${w}”`).join(', ') })}</p>}
              {softProfile && <p>{t('soft_flag_profile')}</p>}
              <p>{t('soft_flag_body')}</p>
            </div>
          )}
                    <PrimaryButton onClick={submit}>{t('continue')}</PrimaryButton>
        </>
      }
    />
  );
}

/** Step 1: location first. Picking a place starts the facility search in the background. */
export function PlaceScreen() {
  const { s, dispatch } = useFlow();
  const t = useT();
  const set = (patch: Partial<FlowState>) => dispatch({ type: 'set', patch });
  return (
    <Shell
      left={<IntroPanel note={t('map_intro')} />}
      right={
        <>
          <StepHeader step={1} />
          <Bubble>{t('hello')}</Bubble>
          <ScreenTitle>{t('where_title')}</ScreenTitle>
          <section className="flex flex-col gap-2 rounded-[var(--hc-r-card)] border-[1.5px] border-[var(--hc-border)] p-4">
            <UseMyLocation onPlace={(p) => set({ place: p })} />
            <p className="text-[15px] font-semibold">{t('or_choose')}</p>
            <States>
              {({ rows, loading, error, sample }) => (
                <div>
                  <label htmlFor="state" className="block text-[15px] font-semibold">{t('state')} {sample && <SampleBadge />}</label>
                  {loading ? (
                    <Spinner label={t('loading_places')} />
                  ) : error ? (
                    <Notice status="bad">{t('error_data')}</Notice>
                  ) : (
                    <select id="state" value={s.state} onChange={(e) => set({ state: e.target.value, place: null })} className="mt-1 min-h-11 w-full rounded-[var(--hc-r-control)] border-[1.5px] border-[var(--hc-control)] bg-white px-3 text-[16px]">
                      <option value="">{t('choose_state')}</option>
                      {rows.map((st) => (
                        <option key={st} value={st}>{titleCase(st)}</option>
                      ))}
                    </select>
                  )}
                </div>
              )}
            </States>
            {s.state && (
              <Places state={s.state}>
                {({ rows, loading, error }) =>
                  loading ? <Spinner label={t('loading_places')} /> : error ? <Notice status="bad">{t('error_data')}</Notice> : <PlaceSearch key={s.state} places={rows} chosen={s.place} onPick={(p) => set({ place: p })} onClear={() => set({ place: null })} />
                }
              </Places>
            )}
            <p className="text-[15px] text-[var(--hc-muted)]">{t('radius_auto')}</p>
          </section>
          {s.place && <BackgroundSearch />}
          {!s.place && <p className="text-[15px] text-[var(--hc-muted)]">{t('need_place')}</p>}
          <PrimaryButton disabled={!s.place} onClick={() => dispatch({ type: 'go', screen: 'intent' })}>{t('continue')}</PrimaryButton>
        </>
      }
    />
  );
}
