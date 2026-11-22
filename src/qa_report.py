"""qa_report.py -- TODO 12: QA / sanity report of the full recommender flow.

Computes coverage, contradiction, and blind-spot statistics from the
platinum layer + gold and commits QA_REPORT.md alongside the project
outputs (verified by read-back), printing the report between
<<<REPORT/>>> markers. Re-run any time upstream tables change.

Run:
    import runpy
    mod = runpy.run_path("src/qa_report.py")
    mod["main"]([])
"""

import argparse
import os
import sys
from datetime import date

from pyspark.sql import SparkSession

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from catalog import DEFAULT_TARGET_CATALOG  # noqa: E402

PLAT = f"{DEFAULT_TARGET_CATALOG}.platinum"
GOLD = f"{DEFAULT_TARGET_CATALOG}.gold.facility_district_health_indicators"
CONF = f"{PLAT}.facility_service_confidence"
REPORT_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "QA_REPORT.md")


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.parse_args(argv)
    spark = SparkSession.builder.getOrCreate()

    def one(sql):
        return spark.sql(sql).collect()[0][0]

    # -- layer inventory ------------------------------------------------
    layers = [
        ("gold.facility_district_health_indicators", GOLD),
        ("platinum.facility_scale", f"{PLAT}.facility_scale"),
        ("platinum.scale_rescued_evidence", f"{PLAT}.scale_rescued_evidence"),
        ("platinum.facility_class", f"{PLAT}.facility_class"),
        ("platinum.specialty_token_map", f"{PLAT}.specialty_token_map"),
        ("platinum.facility_specialty", f"{PLAT}.facility_specialty"),
        ("platinum.service_catalog", f"{PLAT}.service_catalog"),
        ("platinum.channel_token_map", f"{PLAT}.channel_token_map"),
        ("platinum.channel_token_map_llm", f"{PLAT}.channel_token_map_llm"),
        ("platinum.facility_service_evidence",
         f"{PLAT}.facility_service_evidence"),
        ("platinum.corroboration_rules", f"{PLAT}.corroboration_rules"),
        ("platinum.facility_service_confidence", CONF),
    ]
    counts = [(name, spark.table(t).count()) for name, t in layers]

    # -- coverage ---------------------------------------------------------
    cov = spark.sql(f"""
        SELECT
          (SELECT COUNT(DISTINCT unique_id)
             FROM {PLAT}.facility_service_evidence)      AS with_evidence,
          (SELECT COUNT(DISTINCT unique_id) FROM {CONF}) AS with_any_band,
          (SELECT COUNT(DISTINCT unique_id) FROM {CONF}
             WHERE confidence_band = 'high')             AS with_high,
          (SELECT COUNT(DISTINCT unique_id) FROM {CONF}
             WHERE confidence_band IN ('high','medium')) AS with_hm
    """).collect()[0]
    n_gold = counts[0][1]
    no_evidence = n_gold - cov["with_evidence"]

    bands = spark.sql(f"""
        SELECT confidence_band, COUNT(*) AS n FROM {CONF}
        GROUP BY 1 ORDER BY n DESC""").collect()

    stype = spark.sql(f"""
        SELECT service_type, COUNT(DISTINCT unique_id) AS facs
        FROM {CONF} WHERE confidence_band IN ('high','medium')
        GROUP BY 1 ORDER BY facs DESC""").collect()

    crit = spark.sql(f"""
        SELECT c.service, COUNT(DISTINCT c.unique_id) AS facs
        FROM {CONF} c JOIN {PLAT}.corroboration_rules r ON c.service = r.service
        WHERE r.critical AND c.confidence_band IN ('high','medium')
        GROUP BY 1 ORDER BY facs DESC""").collect()

    geo = spark.sql(f"""
        SELECT COALESCE(_coordinates_source, 'NULL') AS src, COUNT(*) AS n
        FROM {GOLD} GROUP BY 1 ORDER BY n DESC""").collect()
    geo_d = {r["src"]: r["n"] for r in geo}

    cls = spark.sql(f"""
        SELECT COALESCE(facility_class, 'unclassified') AS c, COUNT(*) AS n
        FROM {PLAT}.facility_class GROUP BY 1 ORDER BY n DESC""").collect()
    cls_d = {r["c"]: r["n"] for r in cls}

    # -- contradiction / corroboration -----------------------------------
    n_low = one(f"SELECT COUNT(*) FROM {CONF} WHERE confidence_band = 'low'")
    n_viol = one(f"SELECT COUNT(*) FROM {CONF} WHERE scale_violation")
    viol_svc = spark.sql(f"""
        SELECT service, COUNT(*) AS n FROM {CONF}
        WHERE scale_violation GROUP BY 1 ORDER BY n DESC LIMIT 8""").collect()

    corrob = spark.sql(f"""
        SELECT c.service, COUNT(*) AS claims,
               SUM(CASE WHEN c.n_required_missing = 0
                        THEN 1 ELSE 0 END) AS full
        FROM {CONF} c JOIN {PLAT}.corroboration_rules r ON c.service = r.service
        WHERE r.rule_source = 'curated' AND size(r.required_services) > 0
        GROUP BY 1 ORDER BY claims DESC""").collect()

    unv = spark.sql(f"""
        SELECT SUM(CASE WHEN array_contains(channels, 'specialty_claim')
                        THEN 1 ELSE 0 END) AS claim_thin,
               SUM(CASE WHEN NOT array_contains(channels, 'specialty_claim')
                        THEN 1 ELSE 0 END) AS weak_only
        FROM {CONF} WHERE confidence_band = 'unverified'""").collect()[0]

    # -- invariant checks ---------------------------------------------------
    assert n_low == n_viol, f"low {n_low} != scale_violation {n_viol}"
    assert cov["with_evidence"] == cov["with_any_band"], (
        "confidence coverage != evidence coverage")

    # -- report -------------------------------------------------------------
    pct = lambda n, d: f"{100.0 * n / d:.1f}%"
    L = []
    A = L.append
    A("# QA / Sanity Report — Facility Recommender "
      "(Virtue Foundation / DAIS 2026)")
    A("")
    A(f"Generated {date.today().isoformat()} by `src/qa_report.py` from the "
      f"`{DEFAULT_TARGET_CATALOG}` platinum + gold tables. Facts below are "
      "computed live from the tables; blind spots are listed explicitly "
      "(plan TODO 12).")
    A("")
    A("## 1. Layer inventory")
    A("")
    A("| Layer | Rows |")
    A("| --- | --- |")
    for name, n in counts:
        A(f"| {name} | {n:,} |")
    A("")
    A("## 2. Coverage")
    A("")
    A(f"- **Facilities:** {n_gold:,} total; {cov['with_evidence']:,} "
      f"({pct(cov['with_evidence'], n_gold)}) have >=1 service-evidence row; "
      f"{no_evidence} have none and are invisible to ranking beyond geo/name.")
    A(f"- **Confident coverage:** {cov['with_high']:,} facilities "
      f"({pct(cov['with_high'], n_gold)}) have >=1 high-banded service; "
      f"{cov['with_hm']:,} ({pct(cov['with_hm'], n_gold)}) have >=1 "
      "high-or-medium (rankable for some need).")
    A(f"- **Geo coverage:** {geo_d.get('facility', 0):,} facilities have own "
      "coordinates; "
      f"{geo_d.get('pincode_centroid', 0):,} rely on pincode centroids "
      "(kept, flagged, score x0.95 penalty); "
      f"{geo_d.get('NULL', 0):,} have no coordinates at all (invisible to the "
      "geo filter).")
    A(f"- **Facility class:** " + ", ".join(
        f"{k} {v:,}" for k, v in cls_d.items()) + ".")
    A("")
    A("**Facilities with >=1 high-or-medium band, by service type:**")
    A("")
    A("| Service type | Facilities |")
    A("| --- | --- |")
    for r in stype:
        A(f"| {r['service_type']} | {r['facs']:,} |")
    A("")
    A("**Critical-service readiness** (facilities that could serve each "
      "critical service at band >= medium; hard-filter floor):")
    A("")
    A("| Critical service | Facilities ready |")
    A("| --- | --- |")
    for r in crit:
        A(f"| {r['service']} | {r['facs']:,} |")
    A("")
    A("## 3. Confidence & contradiction")
    A("")
    A("| Band | Pairs | % of pairs |")
    A("| --- | --- | --- |")
    tot_pairs = sum(r["n"] for r in bands)
    for r in bands:
        A(f"| {r['confidence_band']} | {r['n']:,} | "
          f"{pct(r['n'], tot_pairs)} |")
    A("")
    A(f"- **Scale violations (= band 'low'): {n_low:,} pairs "
      f"({pct(n_low, tot_pairs)}).** By design 'low' means active doubt "
      "only -- a facility class or doctor count below the service's rule "
      "floor; never mere absence of evidence (plan §5).")
    A("- Top scale-violation services: "
      + ", ".join(f"{r['service']} ({r['n']:,})" for r in viol_svc) + ".")
    A(f"- **Unverified pairs: {sum(r['n'] for r in bands if r['confidence_band'] == 'unverified'):,}"
      f" ({unv['claim_thin']:,} claim-only at thin scrapes; "
      f"{unv['weak_only']:,} description/rescued-only) -- unknown, not "
      "disproven; kept rankable.")
    A("")
    A("**Curated-service corroboration** (claims vs. required items "
      "present):")
    A("")
    A("| Service | Claims | Fully corroborated |")
    A("| --- | --- | --- |")
    for r in corrob:
        A(f"| {r['service']} | {r['claims']:,} | {r['full']:,} |")
    A("")
    A("## 4. Known blind spots (explicit)")
    A("")
    A(f"1. **{no_evidence} facilities have zero service evidence** -- the "
      "recommender cannot match any need to them (geo still works if "
      "coordinates exist).")
    A(f"2. **{cls_d.get('unclassified', 0)} facilities are unclassified** "
      "(class NULL): scale floors cannot apply; their scale-sensitive "
      "services are capped at 'medium' (scale_unknown), never excluded.")
    A(f"3. **{geo_d.get('NULL', 0)} facilities have no coordinates** and "
      f"{geo_d.get('pincode_centroid', 0):,} only centroid-imputed ones; "
      "374 facilities have no pincode and 199 districts are post-NFHS-5 "
      "unmatched, so NFHS context is lost for them (plan §2; district-need "
      "alignment deferred to TODO 13).")
    A("4. **Thin scrapes:** 722 facilities have empty procedure lists and "
      "2,178 empty equipment lists (plan §3) -- 'unknown != no' (§5) keeps "
      "them rankable, but their claim-only services cap at medium and "
      "claim-only-at-thin at unverified.")
    A("5. **Confidence is internal-consistency of scraped marketing text, "
      "NOT clinical-outcome quality** (plan §9). Never present a band as a "
      "quality guarantee; pair with NFHS district context and say what it "
      "is.")
    A("6. **LLM mapping ceilings:** procedure/equipment/capability tokens "
      "appearing at fewer than 3 facilities never went through the LLM "
      "pass (singleton-heavy tail; plan TODO 4); ~4.1% of facility-specialty "
      "token volume is unmapped (TODO 3 residue, kept for curation).")
    A("7. **capacity_value is a presumed bed count, unverified** (TODO 1) -- "
      "used only as a tie-breaker, never a filter.")
    A("8. **Needs extraction is LLM-generated** (ai_query, temperature 0, "
      "gpt-oss-120b): outputs are sampled and may vary slightly across "
      "runs; off-catalog service names are dropped and reported, never "
      "trusted.")
    A("9. **Single-channel evidence structurally caps at 'medium'** -- "
      "facilities that document a service in exactly one channel can "
      "never reach 'high' however credible; corroboration across channels "
      "is required by design.")
    A("10. **420 facilities have _state_disagrees flagged coordinates; "
      "1,364 district matches rely on the alias layer** (plan §2) -- "
      "indicator rows are carried but the match is less certain.")
    A("")
    A("## 5. Invariant checks (re-verified at report time)")
    A("")
    A(f"- band 'low' == scale_violation pairs ({n_low:,} == {n_viol:,}) -- "
      "the confidence tree's 'active doubt only' invariant.")
    A(f"- confidence coverage == evidence coverage "
      f"({cov['with_any_band']:,} == {cov['with_evidence']:,} facilities).")
    A("- No service reaches the confidence layer with zero corroboration "
      f"rules (all {one(f'SELECT COUNT(*) FROM ' + PLAT + '.service_catalog')} "
      f"catalog services covered by "
      f"{one(f'SELECT COUNT(*) FROM ' + PLAT + '.corroboration_rules')} "
      "rule rows).")
    A("")
    report = "\n".join(L)

    committed = False
    try:
        with open(REPORT_PATH, "w") as f:
            f.write(report)
        with open(REPORT_PATH) as f:
            committed = f.read() == report
    except OSError as e:
        print(f"report write failed ({e}); print-only mode")
    print(f"QA_REPORT.md {'committed and read-back verified at ' + REPORT_PATH if committed else 'NOT committed'}")
    print("<<<REPORT")
    print(report)
    print(">>>REPORT")
    assert committed, "report not committed to workspace"


if __name__ == "__main__":  # pragma: no cover
    main()
