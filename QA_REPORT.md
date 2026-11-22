# Facility Recommender — QA & Sanity Report

Generated 2026-11-22 by `src/report.py` (deterministic SQL over
`labuser_jdw2` gold/platinum tables; no LLM calls).
Companion to `RECOMMENDER_PLAN.md`. Acceptance: report committed
alongside outputs; blind spots explicitly listed (§5).

## 1. Coverage

- Gold facilities: **10,077** (11 duplicate `unique_id`s collapsed
  at ingest; 0 residual `_dupe_conflict` rows)
- Facilities with >=1 evidence row: **9,987** (99.1%); evidence rows: 279,626 (facility x service x channel)
- Facilities with >=1 confidence row: **9,987** (99.1%); confidence pairs: 201,395
- With >=1 **high**-banded service: **9,428** (93.6%); >=1 medium: 9,768
- Band distribution: medium 143,651 / high 53,330 / low 2,096 / unverified 2,318
- Evidence channels (rows / facilities): specialty_claim 104,585/9,959; procedure 69,157/8,630; capability 66,173/9,778; equipment 25,393/6,551; description 14,314/5,792; rescued_capability 3/1; rescued_equipment 1/1

Facility class x high-band coverage:

| class | facilities | with >=1 high |
| --- | --- | --- |
| hospital | 5,490 | 5,110 (93.1%) |
| clinic | 1,959 | 1,839 (93.9%) |
| dental_clinic | 1,768 | 1,739 (98.4%) |
| diagnostic_center | 637 | 611 (95.9%) |
| unclassified | 149 | 58 (38.9%) |
| physiotherapy_rehab | 67 | 65 (97.0%) |
| pharmacy | 7 | 6 (85.7%) |

## 2. Contradiction / scale-violation rate

- Low band = scale violation only (TODO 7 design): **2,096** pairs (1.0% of confidence pairs)
- By type: facility class below floor 1,868 / doctor count below floor 265 / both 37
- Facilities with >=1 low pair: 1,208 — still rankable for
  other services; low only hard-filters that service on critical needs
  (plan §7.3)
- Top services by low count: neurosurgery 367; laparoscopicSurgery 252; medicalOncology 217; jointReplacementSurgery 142; spineSurgery 130; fractureCare 124; transplantSurgery 117; tumorRemoval 112; angioplasty 96; surgicalOncology 96

## 3. Corroboration of high-value services (curated rules with
required items)

| service | claims | fully corroborated |
| --- | --- | --- |
| laparoscopicSurgery | 2,109 | 893 (42.3%) |
| neurosurgery | 1,852 | 638 (34.4%) |
| jointReplacementSurgery | 1,490 | 713 (47.9%) |
| surgicalOncology | 1,159 | 390 (33.6%) |
| spineSurgery | 853 | 279 (32.7%) |
| tumorRemoval | 846 | 365 (43.1%) |
| cataractSurgery | 770 | 234 (30.4%) |
| transplantSurgery | 753 | 64 (8.5%) |
| cardiacSurgery | 655 | 64 (9.8%) |
| hysterectomy | 616 | 255 (41.4%) |
| angioplasty | 525 | 206 (39.2%) |
| kidneyTransplant | 442 | 53 (12.0%) |
| cabgSurgery | 346 | 33 (9.5%) |
| appendectomy | 260 | 125 (48.1%) |
| pacemakerImplantation | 231 | 120 (51.9%) |
| liverTransplant | 157 | 20 (12.7%) |
| interventionalCardiology | 154 | 76 (49.4%) |

## 4. Critical-service availability (facilities with high band)

| service | high-band facilities |
| --- | --- |
| jointReplacementSurgery | 336 |
| neurosurgery | 122 |
| radiotherapy | 107 |
| spineSurgery | 99 |
| angioplasty | 44 |
| pacemakerImplantation | 28 |
| transplantSurgery | 21 |
| kidneyTransplant | 16 |
| cardiacSurgery | 14 |
| liverTransplant | 8 |
| interventionalCardiology | 7 |
| cabgSurgery | 6 |

## 5. Known blind spots (explicit)

1. **Thin scrapes:** 722 facilities have empty
 `procedure` arrays, 2,178 empty `equipment` arrays.
   Unknown != no (plan §5): missing channels never disprove a service;
   bands cap at medium/unverified instead.
2. **No evidence at all:** 90 facilities have
   zero evidence rows — never recommended (nothing scoreable), but remain
   in gold.
3. **Geo/context gaps:** 159 facilities lack a pincode;
 374 have no district (NFHS match not attempted);
 188 facilities in post-split districts map to their
   pre-split NFHS-5 parents (TODO 13: NTR->Krishna,
   Chengalpattu->Kancheepuram, ... via `silver.district_parent_map`,
   `_district_match_method = 'parent'`, never silent — indicators are
   the parent district's values); only
 11 remain unmatched (Purba Bardhaman — this
   NFHS copy lacks undivided Barddhaman; sibling Paschim Barddhaman is
   not a parent) — NULL indicators, flagged.
4. **Centroid coordinates:** 35 facilities use
   pincode-centroid coordinates (flagged `coord_source`, x0.95 penalty —
   never excluded); their distance is to the pincode area, not the
   facility.
5. **Scale data partiality:** n_doctors present for 3,628/10,077 facilities, capacity_value (presumed beds,
   unverified) for 2,511; unclassified facilities (class NULL)
   degrade scale checks to `scale_unknown`, capping bands at medium for
   floored services.
6. **Token tail:** singleton tokens are 45-68% of per-channel volume
   (one-off scrape sentences) and remain mostly unmapped. The
   2026-11-22 curation pass (`--llm-min 2` over the 4,334 two-facility
   tokens + curated RULES / NOT_SERVICE overrides in `catalog.py`)
   brought repeated-token (n_facilities >= 2) unmapped volume to **0**;
   every residual unmapped token is a singleton (`map_method =
   'unmapped'` in `channel_token_map`). LLM rejection sampled in TODO 4
   showed rare false negatives on obscure terms (turbt, imsi, kati vasti).
7. **Confidence semantics:** confidence is *internal-consistency-based*
   on scraped self-description — NOT clinical-outcome quality (plan §9
   risk). Present with district NFHS context and say what it is; never
   as a guarantee.
8. **Needs extraction:** ai_query output is sampled (temperature 0
   minimizes but does not guarantee determinism); off-catalog service
   names are dropped and reported.
9. **Critical surgical scarcity:** fully-corroborated facilities for
   high-acuity procedures are scarce (§3 table) — top-5s for such needs
   honestly show medium bands.

## 6. Recommender acceptance battery (recorded 2026-11-22,
`src/recommend.py`)

- Needs extraction: 10/10 diverse inputs -> sensible vectors;
  0 off-catalog names.
- Geo: pincode 143001 + 10 km -> 9/10 nearest same-pincode (0.0-0.6 km);
  centroid-imputed facility flagged, not silently equal.
- Ranking: 10 cases x top-5 defensible by inspection; 0 facilities with
  band 'low' on a critical need in any top-5 (asserted per case).
- Explanations: 50/50 recommended facilities carry explanations built
  only from platinum tables; bands cross-checked against the ranker's
  matched map (two independent join paths).

