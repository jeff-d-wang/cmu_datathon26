# Heart care finder (skeleton)

A patient-facing heart-care finder for India, built as a **Databricks App** (AppKit: React + TypeScript), desktop layout (1280×800).
CMU Datathon 2026. Visual reference: `../design/*.dc.html`.

> Status: **skeleton**. Runs on clearly labelled **sample data** by default. Live, read-only queries are wired in behind a flag.
> Not medical advice. Every symptom rule is a **DRAFT that needs clinician review**.

## Run it

```bash
npm install
npm run dev                 # http://localhost:8000 (uses the `datathon` profile from .env)
npm test                    # 32 unit tests (red flags, ranking, warnings, radius, place search)
npx playwright test         # 4 smoke tests through the whole flow; screenshots in tests/screenshots/
databricks apps validate --profile datathon   # typegen, lint, typecheck, build, tests
```

**Sample vs live data:** `client/.env` → `VITE_USE_SAMPLE_DATA=true` (the default) uses `client/src/sample/sampleData.ts`, a set of fictional places. Set it to `false` to use the live queries.
Live mode needs the app's service principal to have `USE CATALOG`, `USE SCHEMA` and `SELECT` on
`databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset`. Locally, queries run as **you**, via the CLI profile.

## The flow (state machine, no accounts)

| Screen | File |
|---|---|
| 1 Intent (nothing preselected; "Help right now" → Emergency in one click) | `client/src/screens/Onboarding.tsx` |
| 1b Emergency (112 / 108, while-you-wait, places listing emergency care "not verified") | `client/src/screens/Emergency.tsx` |
| 2 Who is it for (age 0–120 or blank, sex, optional conditions that only boost) | `client/src/screens/Onboarding.tsx` |
| 3 Symptoms + safety check + place (state list, spelling-tolerant search, automatic radius) | `client/src/screens/Symptoms.tsx` |
| 4 Results ("N matches in our data", Show 5/10/20, service chips, nearest emergency strip, map on demand, share) | `client/src/screens/Results.tsx` |
| 5 Facility detail (what the data lists vs does not, ask-when-you-call, contact, payment) | `client/src/screens/Detail.tsx` |

Every screen shows the emergency banner and "Start over (new person)", which clears all state.

## How decisions are made (transparent)

- **Red flags** (`client/src/domain/redflags.ts`). Only explicit answers open the Emergency screen: a safety-check tick, or picking stroke signs. Softer signals (a red-flag word in what was typed, or chest pain at age ≥ 40 with diabetes or known heart disease) show a red warning with an "It is happening now: get help" button, and the user can still continue. Word matching doesn't understand negation ("no sweating"), which is why it warns instead of redirecting.
- **Symptom → service map:** `config/symptom_map.json`. **DRAFT: needs clinician review.**
- **Ranking** (`client/src/domain/ranking.ts`). A pure function, unit-tested. Its components are service match, evidence (independent fields that mention the service), equipment, emergency readiness, distance, data quality, and cath-lab/surgery level.
  - Urgent mode weights emergency readiness and distance highest; planned mode ("Plan heart surgery") weights surgery evidence highest.
  - Conditions add small, explained **boosts** and never hide a place.
  - The UI shows each component score and its weight ("Why it is listed here").
- **Warnings** (`client/src/domain/warnings.ts`). At most 2 per card, in a fixed order:
  1. approximate location
  2. ICU claimed with no equipment
  3. cardiology tag only
  4. emergency claim not backed
  5. possible merged branches
  6. large procedure claimed by a small facility

  Each has a "Why?" that quotes the record. Truncated lists (cut at 50 items) show as an info note: "not listed" means unknown.
- **Distances** are haversine (straight line), labelled as such. The radius widens automatically (25 → 50 → 100 → 250 km) and the screen says when it has widened.

## Privacy

- Nothing the user types is stored or logged. State lives in React memory only: no cookies, no localStorage, no accounts.
- Symptoms, age, sex and conditions **never leave the browser**. Parsing, red flags and ranking all run in the browser.
- The server receives only:
  - a bounding box **rounded outward to a 0.5° grid** (about 50 km), so query history never holds an exact location;
  - a state name, from a list, for place search. Typed place text is matched in the browser.
- Share links (Copy / WhatsApp) put only the place and filters in the URL **#fragment**, which browsers never send to the server. They never include symptoms, age, sex or conditions.
- AppKit telemetry is off (`DISABLE_APPKIT_INTERNAL_TELEMETRY=true`, `DO_NOT_TRACK=1` in `app.yaml` and `.env`). There is no custom request logging.
- Fonts are self-hosted (`@fontsource/inter`), with a system font fallback. The map is a plain SVG schematic with **no tiles**, so it makes no external requests.
  - "Directions" and "Website" are explicit links that open third-party sites, and the Directions link says so.
- Platform limits: Databricks Apps' own proxy and access logs are outside the app's control.
- Any future LLM use must run inside the workspace (ai_query / model serving), behind a feature flag that defaults to off. None is used now.

## Data (read-only)

`config/queries/*.sql` reuse the cleaning and heart-label logic from `../sql/heart/hb.sql`. Each result stays under 1 MB.

| Query | Returns |
|---|---|
| `heart_candidates` | Heart facilities in a coarse box, `LIMIT 400`, with label evidence, quotes, flags and contact. About 15–20 s per run. |
| `emergency_candidates` | Facilities that list emergency care in a box, `LIMIT 60` |
| `place_lookup` | District and PIN centroids for one state (up to about 380 KB) |
| `states` | The state list |
| `heart_summary` | Counts (not yet used by the UI) |

## What is placeholder

- **Sample data:** fictional facilities and phone numbers (`+91 00000 0000x`).
- **Map:** a schematic SVG instead of a real map.
- **Clinical content:** the symptom map, advice text and warning-signs lesson are **drafts that need clinician review**.
- **Language:** English only. All UI text is in `client/src/i18n/en.ts`, so other languages can be added back as extra tables.
- **Fixed counts:** the onboarding count ("3,622 places") is hard-coded from the exploration.
- **Rough edges in the live queries:**
  - "24/7 customer care" can trigger the 24/7 flag.
  - The first query after a cold warehouse start can take about a minute.
- **Tests:** no tests yet for the live-data path.

## Symptoms → severity → treatment → service (two layers)

**Layer A (always on): rule-based, `config/symptom_map.json`. DRAFT: needs clinician review.**
- Each symptom has a severity tier (`EMERGENCY_NOW` / `URGENT` (24–48 h) / `ROUTINE`), care levels (check-up and tests, cath lab, heart surgery, rhythm care, children's heart care, emergency department), a plain-words treatment sentence, and a cited guideline.
  - Guidelines are real, published titles (AHA/ACC 2021 chest pain; ESC 2021 heart failure, 2018 syncope, 2020 AF), each marked "to verify by clinician".
- Care levels map to the 12 service labels, which drive the ranking.
- Red flags and the Emergency screen come only from Layer A (`client/src/domain/redflags.ts`). Layer B never delays or overrides them.

**Layer B (flag `VITE_OUTCOMES_ENABLED`, default `false`): outcome statistics.**
- **Contract:** `client/src/outcomes/contract.ts`. If the teammate's columns differ, change `adapter.ts`, never the UI.
- **Shown:** "Among people in this dataset who reported X, P% had an emergency visit (95% Wilson interval, n people)", with source, year and country on the same line, and "may differ in India" when the data isn't from India.
- **Guards:**
  - Minimum 30 cases per cell (`outcomes_min_cases`), with fallback to a broader group, which the UI names.
  - Rows with a condition are never used for the overall figure.
  - No prediction language.
  - Layer B can only **raise** the tier (based on the interval's lower bound, DRAFT thresholds in `outcome_thresholds`), never lower it. Mismatches go to the dev console.
- **Validation at load:**
  - counts are sane (`n_emergency ≤ n_cases`, nothing negative);
  - no duplicate cells;
  - age band and sex come from fixed lists;
  - a licence is present;
  - every symptom code exists in `symptom_map.json`.

  Failures throw in dev and hide the feature in prod.
- **Data-quality report:** `npm run outcomes:report -- path/to/file.csv|json` shows row counts, % missing, cells below the minimum, and symptoms with no data.
- **Until the real file exists:** `client/src/outcomes/fixture.sample.json` is labelled **"SAMPLE FIXTURE, NOT REAL DATA"**. It's used and shown only in dev builds, never in production.
- **Tests:** `client/src/outcomes/outcomes.test.ts` covers the Wilson known values, minimum-cell suppression, Layer A never being overridden, the flag hiding Layer B, and validation.
