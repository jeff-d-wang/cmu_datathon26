"""evidence.py -- TODO 5: facility x service x channel evidence table.

Builds platinum.facility_service_evidence on top of the Phase-0/1 platinum
layer -- one row per distinct (unique_id, service, channel):

    specialty_claim     platinum.facility_specialty (TODO 3): canonical
                        specialty claims; token grain was collapsed there, so
                        n_tokens is NULL for this channel.
    procedure           gold JSON arrays -> platinum.channel_token_map (TODO 4)
    equipment           same, equipment channel
    capability          same, capability channel
    rescued_capability  platinum.scale_rescued_evidence (TODO 1): tokens
    rescued_equipment   rescued from numberDoctors/capacity cross-
                        contamination, joined to the token map via their
                        channel_guess; kept as their own channels for
                        provenance (lower trust than native channels).
    description         gold.description prose (9,997 of 10,077 rows
                        populated, avg 179 chars): sentences split on
                        [.!?;:,\n]+ and normalized; a sentence counts as
                        evidence when it (a) exactly equals an already-mapped
                        token in the token map, or (b) matches a catalog RULES
                        regex (first-match); NOT_SERVICE_PATTERNS sentences
                        are dropped.

n_tokens = number of distinct evidence items (tokens or sentences) that
mapped to the service within (facility, channel). Dedupe within
facility+channel happens BEFORE aggregation -- echoed tokens are one source
echoed, not independent votes.

Run:
    import runpy
    mod = runpy.run_path("src/evidence.py")
    mod["main"]([])
"""

import argparse
import os
import sys

from pyspark.sql import SparkSession
from pyspark.sql import functions as F

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from catalog import (  # noqa: E402
    DEFAULT_TARGET_CATALOG, NOT_SERVICE_PATTERNS, RULES,
    facility_tokens, norm_token, write_table)


# ---------------------------------------------------------------------------
# sentence-level rule application (same idea as catalog.apply_rules, but on
# free-text sentences; no n_facilities stat at this grain)
# ---------------------------------------------------------------------------
def rule_first_match(colname):
    """First-match service Column over RULES (NULL when nothing matches)."""
    service = None
    for pat, name in RULES:
        cond = F.col(colname).rlike(pat)
        service = (F.when(cond, F.lit(name)) if service is None
                   else service.when(cond, F.lit(name)))
    return service


def not_service_flag(colname):
    """True when the text matches any NOT_SERVICE_PATTERNS regex."""
    flag = None
    for pat in NOT_SERVICE_PATTERNS:
        cond = F.col(colname).rlike(pat)
        flag = (F.when(cond, F.lit(True)) if flag is None
                else flag.when(cond, F.lit(True)))
    return flag.otherwise(F.lit(False))


def description_services(spark, gold_table, tmap):
    """gold.description -> distinct (unique_id, sentence, service)."""
    prose = (spark.table(gold_table)
             .where(F.length(F.trim(F.col("description"))) > 3)
             .select("unique_id",
                     F.split(F.lower(F.col("description")),
                             r"[.!?;:,\n]+").alias("parts")))
    sents = (prose.select("unique_id", F.explode("parts").alias("raw"))
             .withColumn("sentence", norm_token(F.col("raw")))
             .where(F.length("sentence") > 3)
             .select("unique_id", "sentence")
             .distinct())
    # (a) sentence text exactly equals an already-mapped token
    tok_hits = (sents.join(tmap, sents.sentence == tmap.token, "inner")
                .select("unique_id", "sentence", "service"))
    # (b) catalog RULES regexes applied directly to the sentence
    rule_hits = (sents.select(
                     "unique_id", "sentence",
                     rule_first_match("sentence").alias("service"),
                     not_service_flag("sentence").alias("_ns"))
                 .where(F.col("service").isNotNull() & ~F.col("_ns"))
                 .select("unique_id", "sentence", "service"))
    return (tok_hits.unionByName(rule_hits)
            .select("unique_id", "sentence", "service")
            .distinct())


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.parse_args(argv)

    spark = SparkSession.builder.getOrCreate()
    gold = f"{DEFAULT_TARGET_CATALOG}.gold.facility_district_health_indicators"
    plat = f"{DEFAULT_TARGET_CATALOG}.platinum"

    tmap = (spark.table(f"{plat}.channel_token_map")
            .where(F.col("service").isNotNull())
            .select("channel", "token", "service"))

    # 1. specialty claims ---------------------------------------------------
    spec_ev = (spark.table(f"{plat}.facility_specialty")
               .select("unique_id",
                       F.col("canonical_specialty").alias("service"))
               .withColumn("channel", F.lit("specialty_claim"))
               .withColumn("n_tokens", F.lit(None).cast("int")))

    # 2. procedure / equipment / capability tokens --------------------------
    ft = facility_tokens(spark, gold)
    tok_ev = (ft.join(tmap, ["channel", "token"])
              .groupBy("unique_id", "channel", "service")
              .agg(F.count("*").alias("n_tokens")))

    # 3. rescued arrays from numberDoctors / capacity -----------------------
    res = (spark.table(f"{plat}.scale_rescued_evidence")
           .select("unique_id",
                   F.col("channel_guess").alias("channel"),
                   norm_token(F.col("token")).alias("token"))
           .distinct())
    res_ev = (res.join(tmap, ["channel", "token"])
              .withColumn("channel",
                          F.concat(F.lit("rescued_"), F.col("channel")))
              .groupBy("unique_id", "channel", "service")
              .agg(F.count("*").alias("n_tokens")))

    # 4. description prose ---------------------------------------------------
    desc_ev = (description_services(spark, gold, tmap)
               .groupBy("unique_id", "service")
               .agg(F.count("*").alias("n_tokens"))
               .withColumn("channel", F.lit("description")))

    # 5. union, attach service_type, write ------------------------------------
    cols = ["unique_id", "service", "channel", "n_tokens"]
    ev = (spec_ev.select(*cols)
          .unionByName(tok_ev.select(*cols))
          .unionByName(res_ev.select(*cols))
          .unionByName(desc_ev.select(*cols)))
    cat = (spark.table(f"{plat}.service_catalog")
           .select("service_name", "service_type"))
    ev = (ev.join(cat, ev.service == cat.service_name, "left")
          .drop("service_name")
          .select("unique_id", "service", "service_type",
                  "channel", "n_tokens"))
    write_table(spark, ev, f"{plat}.facility_service_evidence")

    # ------------------------------------------------------------------ QA --
    e = spark.table(f"{plat}.facility_service_evidence")

    n_rows = e.count()
    n_dist = e.select("unique_id", "service", "channel").distinct().count()
    print(f"\nacceptance 1: row count {n_rows:,} == distinct "
          f"(facility, service, channel) triples {n_dist:,}")
    assert n_rows == n_dist

    per_ch = (e.groupBy("channel")
              .agg(F.count("*").alias("rows"),
                   F.countDistinct("unique_id").alias("facilities"))
              .orderBy("channel"))
    per_ch.show(20, truncate=False)
    tot_ch = per_ch.agg(F.sum("rows")).collect()[0][0]
    assert n_rows == tot_ch, f"per-channel sum {tot_ch:,} != total {n_rows:,}"
    print("acceptance 1 (cross-foot): per-channel rows sum to the total")

    bad = e.where(F.col("service_type").isNull()).count()
    print(f"services missing from service_catalog: {bad}")
    assert bad == 0

    n_gold = spark.table(gold).count()
    n_facs = e.select("unique_id").distinct().count()
    print(f"facilities with >=1 evidence row: {n_facs:,} of {n_gold:,} gold rows")

    # independent SQL recomputation of the 3 token channels
    sqlx = {r["channel"]: r["triples"] for r in spark.sql(f"""
        WITH ft AS (
          SELECT unique_id, 'procedure' AS channel,
                 explode(from_json(trim(procedure), 'array<string>')) AS raw
          FROM {gold}
          UNION ALL
          SELECT unique_id, 'equipment' AS channel,
                 explode(from_json(trim(equipment), 'array<string>')) AS raw
          FROM {gold}
          UNION ALL
          SELECT unique_id, 'capability' AS channel,
                 explode(from_json(trim(capability), 'array<string>')) AS raw
          FROM {gold}
        ),
        norm AS (
          SELECT DISTINCT unique_id, channel,
                 trim(regexp_replace(lower(trim(raw)), '[^a-z0-9]+', ' ')) AS token
          FROM ft
          WHERE trim(regexp_replace(lower(trim(raw)), '[^a-z0-9]+', ' ')) != ''
        ),
        j AS (
          SELECT n.unique_id, n.channel, m.service
          FROM norm n
          JOIN {plat}.channel_token_map m
            ON n.channel = m.channel AND n.token = m.token
          WHERE m.service IS NOT NULL
        )
        SELECT channel,
               COUNT(DISTINCT unique_id || '|' || service) AS triples
        FROM j GROUP BY channel ORDER BY channel
    """).collect()}
    pyx = {r["channel"]: r["rows"] for r in
           e.where(F.col("channel").isin(["procedure", "equipment", "capability"]))
            .groupBy("channel").agg(F.count("*").alias("rows")).collect()}
    print("SQL cross-check of token channels:", sqlx)
    print("python pipeline per-channel rows:  ", pyx)
    assert sqlx == pyx, "SQL recomputation disagrees with the pipeline"
    print("acceptance 2: independent SQL recomputation of the 3 token "
          "channels matches the pipeline")

    # 5-facility spot check against raw gold rows
    print("\n=== 5-facility spot check (evidence rows vs raw gold) ===")
    ids = [r["unique_id"] for r in
           (e.groupBy("unique_id")
             .agg(F.countDistinct("channel").alias("nch"))
             .where(F.col("nch") >= 3)
             .orderBy(F.rand(5))
             .limit(5).collect())]
    gmap = {r["unique_id"]: r for r in
            (spark.table(gold)
             .where(F.col("unique_id").isin(ids))
             .select("unique_id", "name", "specialties", "procedure",
                     "equipment", "capability", "description")
             .collect())}
    for uid in ids:
        row = gmap[uid]
        print(f"\n--- {uid} | name: {row['name']}")
        for c in ("specialties", "procedure", "equipment",
                  "capability", "description"):
            v = (row[c] or "")[:220]
            print(f"    {c}: {v}")
        (e.where(F.col("unique_id") == uid)
          .orderBy("channel", "service")
          .show(60, truncate=45))


if __name__ == "__main__":  # pragma: no cover
    main()
