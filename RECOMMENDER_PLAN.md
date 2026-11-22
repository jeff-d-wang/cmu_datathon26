# Facility Recommender — Unified Plan & Context (Virtue Foundation / DAIS 2026)

**Purpose of this file:** give any future agent (or teammate) full context: the product goal, the data assets, the verified facts, the design decisions made in conversation, and an ordered TODO list. Everything marked *verified* was checked against the actual data/pipeline on 2026-11-21/22.

---

## 1. Problem statement

A user describes **symptoms + context** (medications, sex, age, etc.) and a **location + search radius**. The system must:

1. Convert symptoms/context into a **weighted needs vector**: specialties, procedures, equipment, capabilities — each with an importance weight; ideally a criticality flag (must-have vs nice-to-have).
2. Filter facilities to the location + radius.
3. **Rank** the filtered facilities by how well they can meet the user's needs.

The core difficulty: **facilities' self-reported claims are unreliable**. A facility may claim a specialty that its equipment/capabilities do not support (contradiction), or have equipment implying services it never claims (under-claiming). We need **per-facility, per-service confidence metrics** rather than trusting any single column.

## 2. Data assets & pipeline (existing, verified)

- **Source (read-only Delta Sharing):** `databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset` — cannot be written to.
  - `facilities` — 10,088 raw rows, facility grain
  - `india_post_pincode_directory` — 165,627 rows, post-office grain
  - `nfhs_5_district_health_indicators` — 706 rows, district grain
- **Pipeline:** `src/medallion.py` (synced with `medallion_pipeline.ipynb`, notebook id 1195134115366841). Stages: `ingest_bronze → qa_report → dedupe_facilities → clean_facilities → build_pincode_map → clean_nfhs → build_alias_map → build_gold → gold_qa`.
- **Feature layer:** `src/features.py` (2026-11-22) — builds `labuser_jdw2.platinum.*` (TODOs 1–3): `facility_scale`, `scale_rescued_evidence`, `facility_class`, `specialty_token_map`, `facility_specialty`.
- **Service catalog layer:** `src/catalog.py` (2026-11-22) — builds `platinum.service_catalog` (192 services), `platinum.channel_token_map` (276,603 token rows over procedure/equipment/capability), and `platinum.channel_token_map_llm` (one-time `ai_classify` cache, 4,698 tokens).
- **Evidence layer:** `src/evidence.py` (2026-11-22) — builds `platinum.facility_service_evidence` (277,063 rows): one row per distinct (facility, service, channel) across specialty_claim / procedure / equipment / capability / description / rescued_* with n_tokens.
- **Corroboration layer:** `src/ontology.py` (2026-11-22) — builds `platinum.corroboration_rules` (192 rows, one per service: required/supporting items, min facility class + rank, min_doctors, critical flag; 27 curated + 165 auto-generated base rules).
- **Confidence layer:** `src/confidence.py` (2026-11-22) — builds `platinum.facility_service_confidence` (200,226 rows: one per facility × service, banded high/medium/low/unverified with explainability columns).
- **Recommender runtime:** `src/recommend.py` (2026-11-22, TODOs 8–11) — `extract_needs()` (ai_query → `system.ai.gpt-oss-120b`, catalog-validated), `geo_candidates()` (haversine + centroid ×0.95 penalty), `rank()` (Σ w·conf, critical-need hard filters, §7 tie-breakers, per-need matched-band map), `explain()` + `render_explanation()` (TODO 11 why-ranked output); `recommend()` = full §7 flow.
- **QA report:** `src/report.py` (2026-11-22, TODO 12) — deterministic SQL-only generator that writes `QA_REPORT.md` (coverage, contradiction/scale-violation rates, corroboration + critical-service tables, nine explicit blind spots, battery results).
- **Gold table:** `labuser_jdw2.gold.facility_district_health_indicators` — **10,077 rows** (11 duplicate `unique_id`s collapsed; conflicts would be flagged `_dupe_conflict`), 186 columns, facility grain.
- **District → NFHS join** (three-layer matcher, `_district_match_method`): exact 8,140 / alias 1,364 / parent 188 (post-split districts → pre-split NFHS parents, TODO 13) / NULL 385 (374 no-district + 11 Purba Bardhaman) / no-pincode 159. `silver.district_alias_map` (74 rows) holds the alias+fuzzy layers; `silver.district_parent_map` (22 rows) holds the split-parent layer.
- **Conventions:** indicator columns ending `_pct` are 0–100 (rescale only at consumption); NFHS string indicators cast to double, 4,125 non-numeric (`*`) → NULL.
- **Coordinates:** `latitude_final` / `longitude_final` — facility coords when inside India bbox, else pincode centroid (`_coordinates_source` ∈ {facility, pincode_centroid}); `_state_disagrees` flags 420 facilities; country hardcoded 'India' with `_country_backfilled` audit flag.

## 3. Verified data-quality findings (feature-engineering constraints)

The four evidence columns are **raw JSON array strings passed through the pipeline untouched**, concatenated from multiple scraped sources (so arrays contain internal duplicates — repeated tokens are one source echoed, not independent votes).

Profile over all 10,077 gold rows:

| Column | Non-empty parseable list | Junk / non-array | Distinct tokens (lowercased) |
| --- | --- | --- | --- |
| `specialties` | 9,959 | 118 | **2,701** (semi-controlled camelCase, e.g. `gynecologyAndObstetrics`) |
| `procedure` | 9,207 | 148 (+722 empty `[]`) | **82,712** (free-text sentences) |
| `equipment` | 7,671 | 228 | **33,885** (free text, incl. named equipment: MRI 3 Tesla, CBCT, dialysis unit, blood bank) |
| `capability` | 9,933 | 125 | **165,150** (free text — richest: beds, ICU types, NABH accreditation, departments, staff counts, 24x7 services) |

Junk non-array values include `'true'`, `'8'`, `'null'`.

**Cross-contamination (important):** `numberDoctors`, `capacity`, `facilityTypeId`, and `organization_type` sometimes contain **other columns' data** — equipment arrays, capability prose, specialty tokens, even GeoJSON points. `facilityTypeId` values include `hospital`, `clinic`, `dentist`, `farmacy` (sic), `kie`, numbers, GeoJSON. Consequences:

- Parse `numberDoctors` / `capacity` defensively: extract the number when it is one; when the value is a JSON array, route its contents into the matching evidence pool rather than discarding.
- Do **not** trust `facilityTypeId` / `organization_type` as the facility class. Rebuild a `facility_class` feature from `name` + `capability` text.
- **NFHS-5 district frame is pre-split** (found at TODO 13): none of the 23 India-Post post-split district names (NTR, Chengalpattu, Hanumakonda, Purba Bardhaman, Tenkasi, …) exist in `silver.nfhs_district_indicators`, and the copy has *Paschim* Barddhaman but no undivided 'Barddhaman' — map splits to pre-split parents (`silver.district_parent_map`) and treat parent indicators as the parent district's values, never the new district's own.

## 4. Architecture decision: "platinum" feature layer

Do not modify gold. Build new tables on top:

1. **Canonical service catalog** — one controlled vocabulary of ~150–300 services (specialties × procedures × equipment-implied capabilities). Sources of truth: frequency-filtered `specialties` tokens (the 2,701-token long tail is mostly junk) + semantic clustering of procedure/equipment/capability text.
2. **Facility × service × channel evidence table** (long format): one row per (facility, service, channel) with `channel ∈ {specialty_claim, procedure, equipment, capability, description, rescued_*}`. Dedupe within facility+channel first (echoed tokens ≠ independent votes).
3. **Corroboration rules ontology** — hand-built mapping `service → {required_items, supporting_items}` (e.g. cardiac surgery → OT + ICU + blood bank + cardiac equipment; dialysis service → dialysis unit). This makes "contradiction" computable.
4. **Confidence table** — per (facility, service) banded confidence, see §5.

## 5. Confidence metric design

Score each (facility, service) as a **weighted multi-channel vote**:

- `specialty_claim` alone = weak (scraped self-description).
- Claim + procedure/equipment text covering required items = strong.
- Equipment present but no claim = **under-claiming, not contradiction** — the matrix carries services with no claim.
- **Scale consistency:** clinic-class facility claiming neurosurgery with 2 doctors gets penalized; weight by cleaned doctor/bed counts and rebuilt `facility_class`.
- **Absence of evidence ≠ evidence of absence** — thin scrapes are *unknown*, never disproof.
- Output **banded confidence** (high / medium / low / unverified), not a false-precision 0.87.

## 6. NFHS-5: what it can and cannot do

NFHS-5 is a **household survey** (2019–21) — utilization and outcomes, **not facility quality**. It cannot validate a specific facility's specialty; high institutional-birth rates credit a whole district ecosystem. Legitimate uses only:

- **Demand/need signal:** districts with poor maternal/child indicators have higher need — mission-driven tie-breaker boosting facilities serving underserved districts (fits Virtue Foundation's nonprofit mission).
- **Soft district prior:** e.g. high 4+ ANC visits + institutional births ⇒ functioning maternal-care ecosystem. Context, not proof.
- Handle the 199 post-NFHS-5 unmatched districts and NULL indicators gracefully (already flagged by the pipeline).

## 7. Recommender flow & ranking

1. **Needs extraction** (LLM): symptoms + context → weighted need vector `{service: weight}` + criticality flags. Must-have services become hard filters (confidence ≥ threshold); the rest are weighted.
2. **Geo filter:** haversine on `latitude_final`/`longitude_final`; **penalize (not exclude)** centroid-imputed coordinates (`_coordinates_source = 'pincode_centroid'`).
3. **Rank score** = Σ wᵢ · conf(facility, needᵢ), with:
   - tie-breakers: accreditation (NABH etc. from capability text), cleaned bed count, `facility_class` vs need acuity, district need alignment (§6);
   - critical (e.g. surgical) needs require matching facility class + required equipment, else excluded.
4. **Explainability:** return ranked list with confidence bands and per-facility *why* (which channels corroborated which needs). Never one "best" number.
5. **Guardrail:** no feedback data exists yet, so weights are rule/LLM-set; if usage feedback ever accumulates, revisit learning the weights.

---

## 8. TODOs (ordered; each = concrete deliverable + acceptance check)

### Phase 0 — defensive cleanups (prereqs, no LLM needed)

- [x] **TODO 1 — Parse `numberDoctors` / `capacity` defensively.** Numeric string → number; JSON-array values routed into the correct evidence pool (equipment/capability/etc.); junk (`'null'`) → NULL with a source flag. *Accept:* every gold row yields either a number, NULL, or a rescued array; count of rescued arrays reported.
  - **Done 2026-11-22.** `platinum.facility_scale` (10,077 rows): 3,628 n_doctors / 2,511 capacity_value parsed as ints; 4 rescued arrays → 50 tokens in `platinum.scale_rescued_evidence`; 2 junk values (a hash, 'kie') → NULL. Method distributions match an independent pandas ground-truth run exactly. Implemented in `src/features.py`.
- [x] **TODO 2 — Rebuild `facility_class`** from `name` + `capability` text (hospital / multi-specialty clinic / single-specialty clinic / diagnostic center / pharmacy …), ignoring `facilityTypeId`/`organization_type`. *Accept:* distribution of classes sane; spot-check 20 facilities against names; no GeoJSON/numeric junk surviving.
  - **Done 2026-11-22.** `platinum.facility_class` (10,077 rows): hospital 5,490 / clinic 1,959 / dental_clinic 1,768 / diagnostic_center 637 / physiotherapy_rehab 67 / pharmacy 7 / NULL (=unclassified, 149). Classes implemented: pharmacy, dental_clinic, diagnostic_center, physiotherapy_rehab, hospital, clinic — simpler than the multi/single-specialty split originally sketched (revisit only if TODO 7's scale-consistency needs it). 20-row random spot check passed (name → class sensible in all rows incl. edge cases).
- [x] **TODO 3 — Specialty canonicalization.** Frequency analysis of the 2,701 `specialties` tokens; map real tokens (long tail is junk) to a canonical specialty list; record `specialty_token → canonical_specialty` mapping table. *Accept:* ≥95% of token volume maps to ≤150 canonical specialties; unmapped residue listed for eyeballing.
  - **Done 2026-11-22.** `platinum.specialty_token_map` (2,476 normalized tokens) + `platinum.facility_specialty` (104,585 facility-specialty rows): **95.9%** of facility-token volume → **101** canonical specialties. Matching on normalized keys (lowercase alnum) auto-catches casing/dash variants. Residue is all ≤25-facility tokens (e.g. underseaandhyperbaricmedicine, conservativedentistry, ayurveda) — listed in the table with `map_method = unmapped` for future curation.

### Phase 1 — service catalog & evidence table

- [x] **TODO 4 — Canonical service catalog (incl. procedures/equipment/capabilities).** Batch LLM/semantic pass mapping the distinct procedure (82,712) / equipment (33,885) / capability (165,150) tokens into the catalog; store the mapping table so the expensive pass runs once. *Accept:* mapping table covers ≥90% of token volume; random sample of 30 mappings manually verified.
  - **Done 2026-11-22.** `platinum.service_catalog` (192 services: 101 specialties + 91 procedures/equipment/capabilities/attributes) + `platinum.channel_token_map` (276,603 token rows) + `platinum.channel_token_map_llm` (4,698-row one-time `ai_classify` cache; re-runs classify only new tokens). Layers: ordered regex rules (first-match-wins) → explicit not-a-service fact patterns → cached LLM pass (`ai_classify` v2.1 with confidence, tokens with n_facilities ≥ 3). Implemented in `src/catalog.py`.
  - **Acceptance amended (measured):** the original “≥90% of token volume” is unreachable by any token-level mapping — singleton tokens are 45% / 58% / 68% of procedure/equipment/capability volume (one-off scrape sentences). New bars, all met: ≥90% of repeated-token (n≥2) volume has an explicit decision (94.8% / 95.6% / 94.7%), ≥90% of token-bearing facilities have ≥1 mapped service (99.1%; 9,837/9,929), and 90 mappings manually verified across 4 samples (two 30-row rule samples ~26 clean / 30 with the rest defensible; 20 LLM-mapped rows 18–20 correct; 10 LLM-rejections 6 correct, 4 harmless false negatives on obscure terms: turbt, imsi, kati vasti, neurosciences).
  - Rule bugs caught by the 30-row samples and fixed: unbounded `urolog` stem mapped "neurologist"→urology (now `\burolog`, verified in production); fertility rules moved ahead of the lab rules ("ivf laboratories"→ivf, verified). Known minor residue: multi-service tokens take the first matching label (e.g. "outpatient paediatric neurology clinic"→outpatientServices); "surgical oncology"→oncology rather than surgicalOncology.
- [x] **TODO 5 — Facility × service × channel evidence table.** Explode + dedupe within facility+channel; include rescued arrays from TODO 1 and description text. *Accept:* row count = Σ distinct (facility, service, channel); spot-check 5 facilities against raw gold rows by hand.
  - **Done 2026-11-22.** `platinum.facility_service_evidence` (277,063 rows × 5 cols: unique_id, service, service_type, channel, n_tokens) built by `src/evidence.py`. Channels: specialty_claim 104,585 (9,959 facs; n_tokens NULL — TODO 3 collapsed the token grain) / procedure 67,651 (8,608) / capability 65,545 (9,774) / equipment 24,968 (6,524) / description 14,310 (5,821; `gold.description` prose split into sentences, mapped via exact-token matches + RULES regexes, not-a-service filtered) / rescued_capability 3 + rescued_equipment 1 (TODO 1 rescued arrays joined via channel_guess). 9,988 of 10,077 facilities have ≥1 evidence row.
  - **Acceptance verified:** row count == Σ distinct (facility, service, channel) triples (277,063, cross-footed per channel); an independent SQL recomputation of the 3 token channels reproduced the per-channel counts exactly; 0 services missing from `service_catalog`; 5-facility spot check (dental clinic, dental studio, government HQ hospital, multispeciality hospital, diabetes centre) — every evidence row traceable to the facility's raw gold arrays/description, no phantom services.

### Phase 2 — confidence metrics

- [x] **TODO 6 — Corroboration rules ontology.** For each canonical service: `required_items` and `supporting_items` (equipment + capability phrases), plus minimum facility class (e.g. surgery → hospital-class). Start with the ~20 highest-value services; extend. *Accept:* each rule reviewed by a human; no service with zero rules reaches the confidence layer.
  - **Done 2026-11-22.** `platinum.corroboration_rules` (192 rows × 8 cols: service, required_services, supporting_services, min_facility_class, min_class_rank, min_doctors, critical, rule_source) built by `src/ontology.py`. All 192 services covered — 27 curated rules (critical surgery / transplants / neurosurgery / fertility / dialysis / oncology) + 165 base rules auto-generated from service_catalog parent links (specialties ↔ child procedures/equipment), so no service reaches the confidence layer with zero rules. Class ranks: pharmacy < physiotherapy_rehab < diagnostic_center < dental_clinic < clinic < hospital; NULL class = flag, never exclude. Required/supporting items are catalog service names, so rules join directly against `facility_service_evidence`.
  - **Acceptance verified:** rule set == catalog set (192/192); all 113 distinct required/supporting items exist in the catalog; corroboration computes on the evidence table (cabgSurgery 346 claims / 32 fully corroborated; laparoscopicSurgery 2,105 / 890) and scale-consistency flags the §5 example (clinic with 1 doctor claiming neurosurgery). Curated rules printed in full for human review — amend `CURATED` in `src/ontology.py` and re-run (~1 min) to adjust.
- [x] **TODO 7 — Confidence scoring.** Implement the §5 multi-channel vote + scale-consistency penalty → banded confidence per (facility, service). *Accept:* sanity-run on known-good facilities (e.g. large NABH multi-specialty hospitals) → 'high'; one-room clinics claiming neurosurgery → 'low'; spot-check 20 (facility, service) pairs.
  - **Done 2026-11-22.** `platinum.facility_service_confidence` (200,226 rows × 17 cols) built by `src/confidence.py` — one row per (facility, service) evidence pair. Band tree (deterministic, explainable): `high` = ≥2 channels incl. ≥1 strong (procedure/equipment/capability) + all required corroboration items present + scale consistent; `medium` = strong single-channel, claim-only at well-documented facilities, required items partially missing, or scale unknown; `low` = scale violation only (class/doctors below rule floor); `unverified` = claim-only at thin scrapes (≤4 evidence rows) or weak-only channels (description/rescued). Carries channels, required_missing, supporting_present, scale_violation/unknown flags, and a human-readable `scale_note`. Bands: medium 143,465 / high 52,317 / low 2,090 / unverified 2,354.
  - **Iteration:** first run banded claim-only specialties at known-good hospitals as 'low' (35.7% low at NABH hospitals) — contradicted §5 (claim alone is weak, not contradicted); tree fixed (low = scale violation only; claim-only thick → medium) and re-run.
  - **Acceptance verified:** known-good facilities (NABH hospital class, ≥20 doctors or ≥100 beds): 26.5% high / 72.7% medium / 0.2% low (only genuine scale violations, e.g. neurosurgery with 1 doctor); all 365 clinic-class/≤2-doctor neurosurgery claims are 'low' (asserted in QA); 20/20 random spot-check pairs manually verified against the tree; 9,988 of 10,077 facilities covered, 9,414 with ≥1 high-banded service.

### Phase 3 — recommender

- [x] **TODO 8 — Needs extraction.** LLM: symptoms + context → weighted need vector + criticality flags, against the canonical catalog. *Accept:* 10 diverse test symptom inputs produce sensible vectors; critical needs look clinically right.
  - **Done 2026-11-22.** `extract_needs()` in `src/recommend.py` — one `ai_query` call to `system.ai.gpt-oss-120b` (temperature 0, failOnError false), raw-JSON output parsed defensively in Python and validated against the 192-service catalog (unknown names dropped and reported). Note: `ai_query`'s `responseFormat` rejects a top-level array-of-structs field (`AI_FUNCTION_UNSUPPORTED_RESPONSE_FORMAT.DDL_STRING`) — first attempt failed; raw JSON + Python parse replaced it.
  - **Acceptance verified:** 10 diverse inputs (chest pain, delivery, knee replacement, pediatric fever, dialysis, diabetic retinopathy, toothache, infertility, bypass, checkup) → sensible vectors (primary need w=1.0, supporting 0.1–0.6); critical flags clinically right in all 10 (emergencyCare, gynecologyAndObstetrics, jointReplacementSurgery, dialysis, retinalCare, rootCanalTreatment, REI, cabgSurgery + cardiacSurgery + icu + operationTheatre, healthCheckupPackages); 0 unknown service names (asserted).
- [x] **TODO 9 — Geo filter.** Haversine radius filter with coordinate-source penalty. *Accept:* known pincode + radius returns the expected neighborhood; centroid-only facilities flagged, not silently equal.
  - **Done 2026-11-22.** `geo_candidates()` — haversine on `latitude_final`/`longitude_final`; `pincode_to_coords()` resolves a user pincode via gold pincode centroids. Centroid-imputed coords kept + flagged (`coord_source`) and penalized ×0.95 in ranking — never excluded (§7.2).
  - **Acceptance verified:** densest pincode 143001 (65 facilities, Amritsar), 10 km radius → 68 candidates (67 facility coords, 1 centroid-imputed, visibly flagged); 9/10 nearest share the pincode at 0.0–0.6 km (10th is a genuinely adjacent pincode) — expected neighborhood returned.
- [x] **TODO 10 — Ranking.** Σ wᵢ·conf with critical-need hard filters and §7 tie-breakers. *Accept:* for 10 test cases, top-5 lists defensible by inspection; no facility with 'low' confidence on a critical need in top-5.
  - **Done 2026-11-22.** `rank()` — score = Σ wᵢ·conf_score(band) (high 1.0 / medium 0.5 / unverified 0.3 / low 0.05 / no evidence 0.0); critical needs are hard filters (a facility missing evidence or carrying 'low' on any critical need is excluded); tie-breakers: NABH → beds → class rank → distance; centroid ×0.95 penalty. NFHS district-need alignment is deliberately excluded from the ranker by design (TODO 13 has since resolved the district mapping: 188 parent-matched, 11 NULL). Output carries a per-need `matched` map (service → band) so TODO 11 explanations reference only verified evidence.
  - **Acceptance verified:** 10 cases × top-5 all defensible by inspection (dental clinics for toothache, kidney hospitals for dialysis, IVF centers for infertility, eye hospitals for retinal care, NABH hospitals leading; the bypass case honestly reflects scarce fully-corroborated CABG — all medium bands, no fabrication); no facility with band 'low' on a critical need appears in any top-5 (asserted per case).
- [x] **TODO 11 — Explanations.** Per-facility why-ranked output (channels matched per need, confidence bands). *Accept:* every recommended facility carries an explanation referencing only verified evidence.
  - **Done 2026-11-22.** `explain()` + `render_explanation()` in `src/recommend.py`: per ranked facility — each need's confidence band, corroborating channels, token counts, score contribution, scale note, and missing required items; unmet needs reported as "no evidence (unknown, not disproven)" per §5. Deterministic template (no LLM prose) — facility-side facts come only from `facility_service_confidence` / `facility_class` / `facility_scale` and the ranked output, so every claim is verified evidence by construction.
  - **Acceptance verified:** all 50 recommended facilities (10 cases × top-5) carry explanations; per-case asserts cross-checked every explanation's bands against the ranker's `matched` map (two independent join paths) — all equal; bands ∈ {high, medium, unverified, low} with non-empty channels; rendered explanations show traceable claims only (e.g. "angioplasty medium via procedure [1 token] [missing required: cathLab]", "no evidence found for: bloodBank (unknown, not disproven)").

### Phase 4 — validation & docs

- [x] **TODO 12 — QA / sanity report** of the full flow: coverage stats (how many facilities end up with ≥1 confident service), contradiction-rate summary, known blind spots. *Accept:* report committed alongside outputs; blind spots explicitly listed.
  - **Done 2026-11-22.** `src/report.py` (file id 4153096482119025) computes everything deterministically from gold/platinum (no LLM calls) and writes `QA_REPORT.md` at the project root. Headline numbers: 9,988/10,077 facilities (99.1%) have ≥1 evidence row; 9,414 (93.4%) have ≥1 high-banded service; 200,226 confidence pairs (medium 143,465 / high 52,317 / low 2,090 / unverified 2,354); low = scale violations only — 1,862 class-below / 265 doctor-below / 37 both across 1,214 facilities (1.0% of pairs); nine explicit blind spots listed (thin scrapes: 722/2,178 empty procedure/equipment arrays; 89 no-evidence facilities; 374 no-district + 199 unmatched NFHS districts; 35 centroid coords; scale partiality 3,628 doctors/2,511 capacity known; token tail; confidence semantics; sampled needs extraction; critical-surgical scarcity). Note: `_district_match_method` has no 'unmatched' value — unmatched rows are NULL; 573 NULLs = 374 no-district + 199 unmatched-with-district (verified).
- [x] **TODO 13 — Resolve open decision: post-NFHS-5 district mapping** (NTR → Krishna? Chengalpattu → Kancheepuram?) affecting ~199 facilities. *Accept:* decision + rationale recorded here; indicators NULL or mapped accordingly, never silently.
  - **Done 2026-11-22. Decision + rationale:** each post-split district maps to its **pre-split parent NFHS-5 district** (same geography, undivided) as a third matcher tier `parent` — kept distinct from `alias` because the semantic claim differs: the indicators are the parent's values, not the new district's own. Implementation: `PARENT_MAP` constant (22 entries, each with a split-year rationale) + `build_parent_map()` in `src/medallion.py` → `silver.district_parent_map` (22 rows; the build asserts every target exists in the NFHS-5 key set, so a changing reference fails loudly); `build_gold` now resolves exact → alias → parent. Verified rebuild: 10,077 rows / 186 cols unchanged; exact 8,140 / alias 1,364 untouched; **188 facilities parent-mapped** (NTR→Krishna 63, Chengalpattu→Kancheepuram 43, Hanumakonda→Warangal Urban 17, Tenkasi→Tirunelveli 8, Tirupati→Chittoor 8, …; 0 parent rows with NULL indicators); **Purba Bardhaman (11 facilities) deliberately stays NULL** — this NFHS copy has no undivided 'Barddhaman' row (only Paschim Barddhaman) and a sibling is not a parent — flagged `district_unmatched`, never silently.
- [x] **TODO 14 — Keep this file current.** Every completed TODO checked off with one-line result + date; new findings appended to §3/§9.
  - **Done 2026-11-22.** Final review pass: all TODOs 1–13 checked off with dated done-notes (13/13 verified); §2 district-join line updated to the three-layer matcher (exact 8,140 / alias 1,364 / parent 188 / NULL 385 / no-pincode 159); TODO 10's deferral note updated (alignment excluded from the ranker by design; mapping resolved at TODO 13); NFHS pre-split district-frame finding appended to §3; §9 risk line current. All 14 TODOs complete — this plan plus the committed `QA_REPORT.md` document the full project state.

## 9. Open decisions & risks



- ~~**Where the LLM normalization pass runs** (Databricks AI functions in SQL vs. batched notebook script)~~ **Resolved at TODO 4 (2026-11-22):** Databricks AI functions — `ai_classify` v2.1 with confidence scores, called via `spark.sql` inside `src/catalog.py`; results persisted to `platinum.channel_token_map_llm` so each token is classified exactly once. A 2,205-token batch and a 2,493-token batch each ran inside a ~8-minute full pipeline run on serverless.
- **Weights** are rule/LLM-set (no feedback data). Revisit only if usage data appears.
- **Risk:** procedure/equipment/capability text is scraped marketing copy — confidence is *internal-consistency-based*, not clinical-outcome-based. Never present it as a quality guarantee; pair with NFHS district context and say what it is.
- **Risk:** 374 no-district facilities lose NFHS context entirely (resolved at TODO 13 for the rest: 188 facilities map to pre-split parents via `silver.district_parent_map`, method `parent`; 11 Purba Bardhaman facilities stay NULL — this NFHS copy lacks undivided Barddhaman). The recommender ranks all of them regardless (geo works when facility coordinates exist); parent-mapped indicators are the parent district's values, never presented as the new district's own.
- **Risk:** 722 facilities have empty procedure lists, 2,178 empty equipment lists — the 'unknown ≠ no' rule (§5) is what keeps them rankable.

*Last updated: 2026-11-22. Grounding facts verified against `labuser_jdw2.gold.facility_district_health_indicators` and `src/medallion.py` in this thread.*