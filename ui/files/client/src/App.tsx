import { useEffect, useReducer } from 'react';
import { FlowCtx } from './flow/context';
import { fromFragment, initialState, reducer } from './flow/state';
import { I18nProvider, makeT } from './i18n';
import type { StringKey } from './i18n/en';
import { IntentScreen, WhoScreen } from './screens/Onboarding';
import { EmergencyScreen } from './screens/Emergency';
import { PlaceScreen, SymptomsScreen } from './screens/Symptoms';
import { PrefetchForPlace, ResultsScreen } from './screens/Results';
import { DetailScreen } from './screens/Detail';
import { HowScoreScreen } from './screens/HowScore';

/**
 * Heart care finder: a state machine with no accounts.
 * Privacy: state is held in memory only (no cookies, no localStorage). A shared link carries
 * only the place and filters, in the URL #fragment, which browsers never send to the server.
 */
export default function App() {
  const [s, dispatch] = useReducer(reducer, undefined, () => fromFragment(window.location.hash, initialState()));

  useEffect(() => {
    document.documentElement.lang = s.lang;
  }, [s.lang]);

  useEffect(() => {
    // Opening a shared link restores it once, then the fragment is cleared so nothing lingers in history.
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
  }, []);

  // Accessibility: on every screen change, reset scroll, set the tab title and move focus to the screen heading.
  useEffect(() => {
    window.scrollTo(0, 0);
    document.getElementById('hc-main')?.scrollTo(0, 0);
    const t = makeT(s.lang);
    document.title = `${t(`title_${s.screen}` as StringKey)} · ${t('app_name')}`;
    const h = document.querySelector<HTMLElement>('[data-screen-title]');
    h?.focus({ preventScroll: true });
  }, [s.screen, s.lang]);

  const screen = (() => {
    switch (s.screen) {
      case 'place':
        return <PlaceScreen />;
      case 'intent':
        return <IntentScreen />;
      case 'emergency':
        return <EmergencyScreen />;
      case 'who':
        return <WhoScreen />;
      case 'symptoms':
        return s.place ? <SymptomsScreen /> : <PlaceScreen />;
      case 'results':
        return s.place ? <ResultsScreen /> : <PlaceScreen />;
      case 'detail':
        return s.place ? <DetailScreen /> : <PlaceScreen />;
      case 'howscore':
        return <HowScoreScreen />;
    }
  })();

  return (
    <FlowCtx.Provider value={{ s, dispatch }}>
      <I18nProvider lang={s.lang}>
        <div className="hc-app">
          {screen}
          {/* Keeps the place's search running across Symptoms → Results → Detail. */}
          {s.place && <PrefetchForPlace />}
        </div>
      </I18nProvider>
    </FlowCtx.Provider>
  );
}
