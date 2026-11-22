# Recommender Integration Guide — web app / AI onboarding

This document is the single source of truth for wiring a frontend (or an AI
assistant) to the hybrid recommender. It assumes no prior context: read top

to bottom and you know what to build.

## 1. What this layer is

`src/hybrid_recommend.py` adds a **survey-first recommendation layer** on top
of the existing pipeline (`recommend.py`, `catalog.py`, `evidence.py`, ...).
Nothing in the existing pipeline was modified — it is called as-is.

The recommendation flow for one patient query:

1. **LLM gate (routing only).** One `ai_query` call (temperature 0) maps the
   free-text query to (a) one of 75 NHAMCS 2022 survey complaint codes (or
   null), and (b) any services the patient explicitly names. Both outputs are
   validated: unknown codes are treated as no-match; unmatched service names
   are reported and dropped, never trusted.
2. **Needs become numbers.** On a survey match, need weights are survey-
   weighted shares of what similar ED visits actually received, each with a
   Wilson 95% CI on the Kish effective n. Explicitly-named services merge as
   weight-1.0 critical needs (labeled, no CI). If no complaint matches, the
   LLM fallback supplies weights — every one labeled `LLM-estimated, no CI`.
3. **Deterministic ranking.** Never-empty policy: radius ladder 25→50→100→300
   km; if critical needs filter everything, a softened retry with a banner;
   last resort a generic emergency-care ranking, labeled LOW confidence.
   Ranking math: `score = Σ (need weight × facility confidence band)`.
4. **Evidence cards.** Every recommendation returns per-need confidence band,
   corroborating channels, score contribution, verbatim quote from the
   facility's own text, and any unmet needs with an explicit note.

The LLM never ranks, never weights (except the labeled fallback), and never
writes explanation text. **Language in, vocabulary out; math decides;
evidence speaks.**

## 2. The one call the web app makes

```python
import sys; sys.path.insert(0, "src")   # modules live in src/
from hybrid_recommend import evidence_card

result = evidence_card(spark, symptoms, context, pin, top_n)
# defaults: context="", top_n=5; signature is
# (spark, symptoms, context="", pin=None, top_n=5)
```

### Inputs

| Input | Type | Required | Notes |
| --- | --- | --- | --- |
| `spark` | SparkSession | yes | Active session with UC access (Free Edition serverless works) |
| `symptoms` | str | yes | Free text, e.g. "chest pain and shortness of breath" or "needs dialysis" |
| `context` | str | no | Patient context, e.g. "58-year-old male, smoker" — improves the gate |
| `pin` | str | yes | 6-digit India Post PIN code, e.g. "302001" |
| `top_n` | int | no | Facilities per result, default 5 |

### Output (plain JSON — fully serializable, verified)

```
{
  "cards": [                 # one per recommended facility
    {
      "rank": 1,
      "unique_id": "<uuid>",   # facility id in gold/platinum
      "name": "Jaipur Hospital",
      "facility_class": "hospital",
      "distance_km": 3.1,
      "nabh": false, "beds": null,
      "score": 3.02,            # = sum of need contributions (auditable)
      "needs": [                # services this facility documents
        {
          "service": "emergencyCare",
          "weight": 0.96,       # need importance (0-1)
          "critical": false,
          "band": "medium",      # facility-side confidence: high > medium > unverified > low
          "channels": ["capability"],   # which source fields corroborate
          "n_tokens": 3,
          "scale_note": "",     # populated when facility scale contradicts the claim
          "required_missing": [],      # corroboration gaps, e.g. CABG without ICU/blood bank
          "contribution": 0.48,  # weight × band value — the score's building block
          "weight_source": "survey share 0.961 (Wilson 95% CI [0.931, 0.978], category Kish n_eff 400; ...)",
          "quote": {"source_field": "capability", "text": "Offers Emergency & Critical Care",
                    "evidence_status": "documented_single"}
        }
      ],
      "unmet": ["ctScanner", "cathLab"],   # raw list from explain()
      "unmet_detail": [        # same info, enriched — prefer rendering this
        {"service": "cathLab", "weight": 0.5, "weight_source": "pathway escalation ...",
         "note": "no evidence found (unknown, not disproven -- absence of evidence is not evidence of absence)"}
      ]
    }
  ],
  "needs_meta": {              # how the needs themselves were derived
    "needs_source": "survey" | "llm",
    "complaint_code": 1050, "complaint_label": "chest pain", "n_visits": 797,
    "weight_source": {"<service>": "<full provenance string>", ...},
    "explicit_services_unmatched": [...]   # names the patient used that failed catalog validation
  },
  "banners": [],               # fallback transparency: radius widenings, CRITICAL_UNAVAILABLE, GENERIC_FALLBACK
  "radius_km": 25
}
```

### The provenance taxonomy (what `weight_source` can say)

* `survey share X (Wilson 95% CI [lo, hi], category Kish n_eff N; ...)` — data-backed
* `LLM-estimated, no CI` — fallback weights, never presented as data
* `explicitly requested by patient (expert-set, no CI)` — user-named service
* `pathway escalation (expert-set, no CI); ...` — guideline rule (chest pain→cath lab, etc.)

Quote `evidence_status` values (facility-side evidence grading):
`documented_multi` (verbatim text in 2+ source fields — strongest) >
`documented_single` (verbatim text in one field) > `structured_field` (from a
structured column) > `tag_only` (tokenized match only — weakest, consider
showing as "weakly documented").

Confidence `band` values: `high` (1.0) > `medium` (0.5) > `unverified` (0.3) >
`low` (0.05). A need missing from a facility appears in `unmet`, not with a
band — never render silence as absence.

## 3. Error & performance contract

* **Unknown PIN**: raises `ValueError` with a user-friendly message — catch and
  display it; do not let it 500. Geography is the one thing never-empty cannot fix.
* **Latency**: ~7s per query (the LLM gate is ~6s; ranking <1s). For repeat
  queries, cache `classify_complaint` keyed on (symptoms, context).
* **No matches anywhere**: still returns cards or an explicit banner — the
  response is never empty without an explanation.

## 4. What the UI must render (rubric-critical)

1. Per facility: score, distance, class, NABH — plus per-need band chips and
   the **verbatim quotes** (the rubric requires citing facility text).
2. The **unmet section** with the unknown-not-disproven note — missing data is
   a feature of the answer, not an error.
3. **Banners** verbatim — they are the honest disclosure of every fallback.
4. Provenance labels next to weights (CI vs LLM-estimated vs expert-set).
5. Fixed disclaimer: **routing aid, not a diagnosis**; emergencies call 112
   (national) / 108 (ambulance).

## 5. Data dependencies

Required (pipeline's own tables): `labuser_jdw2` gold + platinum.
Enrichment (graceful if absent): `workspace.default.facility_services`
(quotes — skips with a printed note if missing) and
`workspace.default.pin_centroids` (PIN fallback for PINs gold lacks, e.g.
Port Blair). If rebuilding elsewhere, share or rebuild those two for the full
experience.

## 6. Verified demo cases (use as smoke tests)

| Query | Context | PIN | Expected |
| --- | --- | --- | --- |
| chest pain and shortness of breath, sweating | 58-year-old male, smoker, diabetic | 302001 | survey path, CI labels, quotes, unmet cathLab |
| severe toothache, swollen gum | 35-year-old male | 500001 | survey path, wide CI (n_eff 58) |
| kidney failure, needs regular dialysis | 52-year-old male | 560001 | LLM fallback, all weights "no CI" |
| gibberish qwerty zzz | | 110001 | LLM fallback, still never-empty |
| chest pain | | 744101 | Port Blair: 2 results, PIN fallback |
| seizures and brain tumor, needs neurosurgery | 40-year-old female | 302001 | explicit service merged as critical |

## 7. Module map

* `survey_needs.py` — NHAMCS complaint profiles, Wilson CIs, 14→192 crosswalk,
  4 escalation pathways. Regenerable: `python src/survey_needs.py --dta <ed2022.dta>`
* `src/data/complaint_profiles.json` — the derived profiles (committed; the
  .dta is NOT needed at runtime)
* `hybrid_recommend.py` — gate, merge, never-empty ranking, evidence cards
* `recommend.py` (existing) — needs extraction, geo candidates, rank, explain

Questions the AI might be asked about this file: it answers WHY (evidence
cards, quotes, bands), HOW (survey weights + CIs, deterministic score math),
and WHERE THE WEAKNESS IS (labeled LLM weights, unmet lists, banners).