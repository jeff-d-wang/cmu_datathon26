"""confidence.py -- TODO 7: banded confidence per (facility, service).

Implements plan §5 as a deterministic multi-channel vote with
scale-consistency penalties, building platinum.facility_service_confidence
-- one row per (facility, service) pair from facility_service_evidence.

Channel trust (plan §5): a specialty_claim alone is weak self-description;
claims backed by procedure/equipment/capability text are strong;
description/rescued text is scraped marketing and never corroborates on
its own.

Bands (explainable decision tree, no false precision):
    high          >=2 evidence channels incl. >=1 strong channel, all
                  required corroboration items present (for rules that have
                  required items), and scale consistent (facility class /
                  doctor count not below the rule floor and not unknown).
    medium        strong single-channel evidence, or multi-channel with
                  required items partially missing, or fully corroborated
                  but scale unknown (unclassified facility / NULL doctors),
                  or a claim-only service at a well-documented facility
                  (claim never echoed in prose, but nothing contradicts it).
    low           scale violation only: facility class or doctor count
                  below the rule floor (e.g. one-room clinics claiming
                  neurosurgery). Active doubt, never mere absence.
    unverified    thin scrapes: claim-only at an otherwise-empty facility,
                  or evidence only from weak channels. 'unknown != no'
                  (plan §5) -- rankable, never disproof.

Run:
    import runpy
    mod = runpy.run_path("src/confidence.py")
    mod["main"]([])
"""

import argparse
import os
import sys

from pyspark.sql import SparkSession
from pyspark.sql import functions as F

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from catalog import DEFAULT_TARGET_CATALOG, write_table  # noqa: E402
from ontology import CLASS_RANK  # noqa: E402

STRONG_CHANNELS = ["procedure", "equipment", "capability"]
THIN_FACILITY_ROWS = 4  # <= this many evidence rows overall = thin scrape


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.parse_args(argv)

    spark = SparkSession.builder.getOrCreate()
    plat = f"{DEFAULT_TARGET_CATALOG}.platinum"

    strong_sql = " OR ".join(
        f"array_contains(channels, '{c}')" for c in STRONG_CHANNELS)
    class_case = ("CASE facility_class "
                  + " ".join(f"WHEN '{k}' THEN {v}"
                             for k, v in CLASS_RANK.items())
                  + " ELSE NULL END")

    conf = spark.sql(f"""
        WITH ev AS (
          SELECT unique_id, service,
                 collect_set(channel)      AS channels,
                 SUM(COALESCE(n_tokens, 1)) AS n_tokens_total
          FROM {plat}.facility_service_evidence
          GROUP BY unique_id, service
        ),
        fac AS (
          SELECT unique_id,
                 collect_set(service) AS svcs,
                 COUNT(*)            AS facility_evidence_rows
          FROM {plat}.facility_service_evidence
          GROUP BY unique_id
        ),
        flagged AS (
          SELECT
            ev.unique_id, ev.service, sc.service_type,
            ev.channels, size(ev.channels) AS n_channels,
            ev.n_tokens_total,
            fac.facility_evidence_rows,
            r.critical,
            size(array_except(r.required_services, fac.svcs))
                                        AS n_required_missing,
            array_except(r.required_services, fac.svcs)
                                        AS required_missing,
            size(array_intersect(r.supporting_services, fac.svcs))
                                        AS supporting_present,
            array_contains(ev.channels, 'specialty_claim') AS has_claim,
            ({strong_sql})                               AS has_strong,
            ((r.min_class_rank IS NOT NULL AND fc_rank.class_rank IS NOT NULL
              AND fc_rank.class_rank < r.min_class_rank)
             OR (r.min_doctors IS NOT NULL AND fs.n_doctors IS NOT NULL
                 AND fs.n_doctors < r.min_doctors))    AS scale_violation,
            ((r.min_class_rank IS NOT NULL AND fc_rank.class_rank IS NULL)
             OR (r.min_doctors IS NOT NULL AND fs.n_doctors IS NULL))
                                                       AS scale_unknown,
            concat_ws("; ",
              CASE WHEN r.min_class_rank IS NOT NULL
                        AND fc_rank.class_rank IS NOT NULL
                        AND fc_rank.class_rank < r.min_class_rank
                   THEN concat('class ', fc.facility_class, ' below ',
                               r.min_facility_class) END,
              CASE WHEN r.min_doctors IS NOT NULL AND fs.n_doctors IS NOT NULL
                        AND fs.n_doctors < r.min_doctors
                   THEN concat('doctors ', CAST(fs.n_doctors AS STRING),
                               ' below ', CAST(r.min_doctors AS STRING)) END,
              CASE WHEN r.min_class_rank IS NOT NULL
                        AND fc_rank.class_rank IS NULL
                   THEN 'class unknown' END,
              CASE WHEN r.min_doctors IS NOT NULL AND fs.n_doctors IS NULL
                   THEN 'doctors unknown' END)     AS scale_note,
            fc.facility_class, fs.n_doctors
          FROM ev
          JOIN fac ON ev.unique_id = fac.unique_id
          JOIN {plat}.service_catalog sc ON ev.service = sc.service_name
          JOIN {plat}.corroboration_rules r ON ev.service = r.service
          JOIN {plat}.facility_class fc ON ev.unique_id = fc.unique_id
          JOIN (SELECT unique_id, facility_class,
                       {class_case} AS class_rank
                FROM {plat}.facility_class) fc_rank
            ON ev.unique_id = fc_rank.unique_id
          JOIN {plat}.facility_scale fs ON ev.unique_id = fs.unique_id
        )
        SELECT
          unique_id, service, service_type, critical, channels, n_channels,
          n_tokens_total, supporting_present, required_missing,
          n_required_missing, facility_class, n_doctors,
          facility_evidence_rows, scale_violation, scale_unknown, scale_note,
          CASE
            WHEN scale_violation THEN 'low'
            WHEN NOT has_strong AND NOT has_claim THEN 'unverified'
            WHEN has_claim AND NOT has_strong
                 AND facility_evidence_rows <= {THIN_FACILITY_ROWS}
              THEN 'unverified'
            WHEN has_strong AND n_channels >= 2 AND n_required_missing = 0
                 AND NOT scale_unknown THEN 'high'
            ELSE 'medium'
          END AS confidence_band
        FROM flagged
    """)

    write_table(spark, conf, f"{plat}.facility_service_confidence")

    # ------------------------------------------------------------------ QA --
    c = spark.table(f"{plat}.facility_service_confidence")
    ev_pairs = (spark.table(f"{plat}.facility_service_evidence")
                .select("unique_id", "service").distinct().count())
    n_pairs = c.select("unique_id", "service").distinct().count()
    assert c.count() == n_pairs == ev_pairs, (
        f"grain mismatch: rows={c.count()} pairs={n_pairs} ev_pairs={ev_pairs}")
    print(f"acceptance 0: {n_pairs:,} confidence rows == "
          f"{ev_pairs:,} distinct (facility, service) evidence pairs")

    print("\n=== band distribution ===")
    c.groupBy("confidence_band").count().orderBy(F.desc("count")).show()
    print("=== band x critical ===")
    (c.groupBy("critical", "confidence_band").count()
     .orderBy("critical", "confidence_band").show())

    print("=== acceptance A: known-good facilities ===")
    print("(NABH-accredited hospital class, >=20 doctors or >=100 beds)")
    spark.sql(f"""
        WITH nabh AS (
          SELECT DISTINCT unique_id
          FROM {plat}.facility_service_evidence
          WHERE service = 'nabhAccredited'
        ), good AS (
          SELECT n.unique_id, fc.name
          FROM nabh n
          JOIN {plat}.facility_class fc USING (unique_id)
          JOIN {plat}.facility_scale fs USING (unique_id)
          WHERE fc.facility_class = 'hospital'
            AND (fs.n_doctors >= 20 OR fs.capacity_value >= 100)
        )
        SELECT c.confidence_band, COUNT(*) AS rows,
               ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct
        FROM {plat}.facility_service_confidence c
        JOIN good g USING (unique_id)
        GROUP BY c.confidence_band ORDER BY rows DESC
    """).show()
    print("--- sample of their high-banded services ---")
    spark.sql(f"""
        WITH nabh AS (
          SELECT DISTINCT unique_id
          FROM {plat}.facility_service_evidence
          WHERE service = 'nabhAccredited'
        ), good AS (
          SELECT n.unique_id, fc.name
          FROM nabh n
          JOIN {plat}.facility_class fc USING (unique_id)
          JOIN {plat}.facility_scale fs USING (unique_id)
          WHERE fc.facility_class = 'hospital'
            AND (fs.n_doctors >= 20 OR fs.capacity_value >= 100)
        )
        SELECT g.name, c.service, c.confidence_band, c.channels
        FROM {plat}.facility_service_confidence c
        JOIN good g USING (unique_id)
        WHERE c.confidence_band = 'high'
        ORDER BY rand(3) LIMIT 10
    """).show(10, truncate=45)

    print("=== acceptance B: suspicious neurosurgery claims ===")
    print("(clinic-class facility or <=2 doctors -- must all be 'low')")
    susp = spark.sql(f"""
        SELECT c.unique_id, c.confidence_band, fc.facility_class,
               fs.n_doctors, c.scale_note
        FROM {plat}.facility_service_confidence c
        JOIN {plat}.facility_class fc USING (unique_id)
        JOIN {plat}.facility_scale fs USING (unique_id)
        WHERE c.service = 'neurosurgery'
          AND (fc.facility_class IS NOT NULL AND fc.facility_class != 'hospital'
               OR fs.n_doctors IS NOT NULL AND fs.n_doctors <= 2)
    """)
    susp.show(10, truncate=45)
    n_susp = susp.count()
    n_low = susp.where("confidence_band = 'low'").count()
    assert n_susp == n_low, (
        f"suspicious neurosurgery pairs not all low: {n_low}/{n_susp}")
    print(f"acceptance B verified: all {n_susp} clinic-class/<=2-doctor "
          f"neurosurgery claims are 'low'")

    print("=== spot check: 20 random (facility, service) pairs ===")
    spark.sql(f"""
        SELECT c.service, c.confidence_band, c.channels,
               c.required_missing, c.supporting_present,
               fc.name, c.facility_class, c.n_doctors, c.scale_note
        FROM {plat}.facility_service_confidence c
        JOIN {plat}.facility_class fc USING (unique_id)
        ORDER BY rand(7) LIMIT 20
    """).show(20, truncate=38)

    print("=== coverage ===")
    spark.sql(f"""
        SELECT COUNT(DISTINCT unique_id) AS facilities_covered,
               COUNT(DISTINCT CASE WHEN confidence_band = 'high'
                                   THEN unique_id END) AS with_high,
               COUNT(DISTINCT CASE WHEN confidence_band = 'medium'
                                   THEN unique_id END) AS with_medium
        FROM {plat}.facility_service_confidence
    """).show()


if __name__ == "__main__":  # pragma: no cover
    main()
