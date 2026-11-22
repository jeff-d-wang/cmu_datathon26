"""ontology.py -- TODO 6: corroboration rules ontology.

Builds platinum.corroboration_rules: one row per canonical service with

    required_services    evidence services that must be present (any
                         channel) for a high-confidence assertion of the
                         service; missing items cap confidence at 'low' /
                         'unverified' (never disproof -- absence of evidence
                         is not evidence of absence, plan §5).
    supporting_services  evidence services that boost confidence when
                         present. Seeded from service_catalog links:
                         specialties get their child procedures/equipment,
                         concrete services get their parent specialty; curated
                         rules add hand-picked corroborators on top.
    min_facility_class   minimum rebuilt facility_class (TODO 2) for the
                         service to be offered at high confidence. Rank
                         order: pharmacy < physiotherapy_rehab <
                         diagnostic_center < dental_clinic < clinic <
                         hospital. NULL class stays NULL -- unclassified
                         facilities are flagged, never excluded.
    min_doctors          scale floor from the cleaned doctor count (TODO 1).
    critical            must-have flag: the recommender treats critical
                         services as hard filters (plan §7).
    rule_source          'curated' (hand-built below for the ~27 highest-
                         value / contradiction-prone services) or 'base'
                         (auto-generated from catalog parent links so every
                         service has a rule -- nothing reaches the confidence
                         layer with zero rules).

Acceptance (plan TODO 6): all 192 catalog services have a rule row; every
referenced required/supporting item exists in the catalog; curated rules
are printed in full for human review -- amend CURATED below and re-run
(~1 min) to adjust.

Run:
    import runpy
    mod = runpy.run_path("src/ontology.py")
    mod["main"]([])
"""

import argparse
import os
import sys

from pyspark.sql import SparkSession
from pyspark.sql import functions as F
from pyspark.sql.types import (ArrayType, BooleanType, IntegerType,
                               StringType, StructField, StructType)

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from catalog import DEFAULT_TARGET_CATALOG, SERVICE_CATALOG, write_table  # noqa: E402
from features import CANONICAL_SPECIALTIES  # noqa: E402

# facility_class rank order (TODO 2 classes); no rank = no requirement.
CLASS_RANK = {
    "pharmacy": 1,
    "physiotherapy_rehab": 2,
    "diagnostic_center": 3,
    "dental_clinic": 4,
    "clinic": 5,
    "hospital": 6,
}

# service -> (required, supporting, min_facility_class, min_doctors, critical)
CURATED = {
    # --- critical surgery / procedures ---
    "cabgSurgery": (["operationTheatre", "icu", "bloodBank"],
                    ["cardiology", "ventilator", "echocardiography"],
                    "hospital", None, True),
    "angioplasty": (["cathLab"], ["cardiology", "icu", "ecgMachine"],
                    "hospital", None, True),
    "pacemakerImplantation": (["cathLab"], ["cardiology", "ecgMachine"],
                              "hospital", None, True),
    "kidneyTransplant": (["operationTheatre", "icu", "bloodBank"],
                         ["nephrology", "dialysis"], "hospital", None, True),
    "liverTransplant": (["operationTheatre", "icu", "bloodBank"],
                        ["gastroenterology"], "hospital", None, True),
    "spineSurgery": (["operationTheatre", "icu"],
                     ["radiology", "mriScanner", "ctScanner"],
                     "hospital", None, True),
    "jointReplacementSurgery": (["operationTheatre"],
                                ["icu", "orthopedicSurgery", "xrayImaging"],
                                "hospital", None, True),
    "tumorRemoval": (["operationTheatre"],
                     ["icu", "bloodBank", "surgicalOncology"],
                     "hospital", None, False),
    "hysterectomy": (["operationTheatre"],
                     ["icu", "bloodBank", "gynecologyAndObstetrics"],
                     "hospital", None, False),
    "appendectomy": (["operationTheatre"], ["icu", "generalSurgery"],
                     "hospital", None, False),
    "laparoscopicSurgery": (["operationTheatre"], ["icu", "generalSurgery"],
                            "hospital", None, False),
    "cataractSurgery": (["operationTheatre"],
                        ["ophthalmology", "ophthalmicEquipment"],
                        "clinic", None, False),
    # --- conservative / outpatient high-value procedures ---
    "fractureCare": ([], ["xrayImaging", "operationTheatre",
                          "orthopedicSurgery"], "clinic", None, False),
    "radiotherapy": ([], ["radiationOncology", "diagnosticServices"],
                     "hospital", None, True),
    "chemotherapy": ([], ["medicalOncology", "pathologyLaboratory"],
                     "clinic", None, False),
    "dialysis": ([], ["nephrology", "pathologyLaboratory"],
                 "clinic", None, False),
    "ivf": ([], ["pathologyLaboratory",
                 "reproductiveEndocrinologyAndInfertility"],
            "clinic", None, False),
    "icsi": ([], ["ivf", "pathologyLaboratory"], "clinic", None, False),
    "iui": ([], ["ivf", "reproductiveEndocrinologyAndInfertility"],
            "clinic", None, False),
    "lithotripsy": ([], ["urology", "xrayImaging"], "clinic", None, False),
    # --- high-value specialty claims (contradiction-prone) ---
    "cardiacSurgery": (["operationTheatre", "icu", "bloodBank"],
                       ["cardiology", "ventilator", "echocardiography",
                        "cathLab"], "hospital", None, True),
    "interventionalCardiology": (["cathLab"],
                                  ["cardiology", "ecgMachine", "icu"],
                                  "hospital", None, True),
    "neurosurgery": (["operationTheatre", "icu"],
                     ["ctScanner", "mriScanner", "ventilator", "radiology"],
                     "hospital", 3, True),
    "transplantSurgery": (["operationTheatre", "icu", "bloodBank"],
                          ["nephrology", "dialysis", "gastroenterology"],
                          "hospital", None, True),
    "surgicalOncology": (["operationTheatre", "icu"],
                          ["bloodBank", "chemotherapy", "radiotherapy",
                           "medicalOncology"], "hospital", None, False),
    "radiationOncology": ([], ["radiotherapy"], "hospital", None, False),
    "medicalOncology": ([], ["chemotherapy"], "hospital", None, False),
}

SCHEMA = StructType([
    StructField("service", StringType(), False),
    StructField("required_services", ArrayType(StringType()), False),
    StructField("supporting_services", ArrayType(StringType()), False),
    StructField("min_facility_class", StringType()),
    StructField("min_class_rank", IntegerType()),
    StructField("min_doctors", IntegerType()),
    StructField("critical", BooleanType(), False),
    StructField("rule_source", StringType(), False),
])


def build_rules():
    """Config build in Python (192 rows, like catalog.py's SERVICE_CATALOG)."""
    children = {}
    for name, _typ, parent in SERVICE_CATALOG:
        if parent:
            children.setdefault(parent, []).append(name)

    all_services = list(CANONICAL_SPECIALTIES) + [s[0] for s in SERVICE_CATALOG]
    rows = []
    for svc in all_services:
        if svc in CANONICAL_SPECIALTIES:
            sup = sorted(set(children.get(svc, [])))
        else:
            parent = next((p for n, t, p in SERVICE_CATALOG if n == svc), None)
            sup = [parent] if parent else []
        req, min_cls, min_doc, crit = [], None, None, False
        source = "base"
        if svc in CURATED:
            req, sup_c, min_cls, min_doc, crit = CURATED[svc]
            sup = sorted(set(sup) | set(sup_c))
            source = "curated"
        rows.append((svc, req, sup, min_cls,
                     CLASS_RANK.get(min_cls), min_doc, crit, source))
    assert len(rows) == len({r[0] for r in rows}), "duplicate service rows"
    return rows


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.parse_args(argv)

    spark = SparkSession.builder.getOrCreate()
    plat = f"{DEFAULT_TARGET_CATALOG}.platinum"

    rules = spark.createDataFrame(build_rules(), SCHEMA)
    write_table(spark, rules, f"{plat}.corroboration_rules")

    # ------------------------------------------------------------------ QA --
    r = spark.table(f"{plat}.corroboration_rules")
    cat_names = {x["service_name"] for x in
                 spark.table(f"{plat}.service_catalog")
                 .select("service_name").distinct().collect()}
    r_names = {x["service"] for x in r.select("service").collect()}
    assert r_names == cat_names, ("rules/catalog mismatch: "
                                  f"only-rules={r_names - cat_names} "
                                  f"only-catalog={cat_names - r_names}")
    n_cur = r.where(F.col("rule_source") == "curated").count()
    n_base = r.where(F.col("rule_source") == "base").count()
    print(f"acceptance 1: all {len(cat_names)} catalog services have a rule "
          f"row ({n_cur} curated + {n_base} base) -- no service reaches the "
          f"confidence layer with zero rules")

    refs = (r.select(F.explode_outer("required_services").alias("s"))
             .unionByName(r.select(F.explode_outer("supporting_services")
                                   .alias("s")))
             .where(F.col("s").isNotNull()).distinct())
    ref_set = {x["s"] for x in refs.collect()}
    bad_refs = ref_set - cat_names
    assert not bad_refs, f"rules reference unknown services: {bad_refs}"
    print(f"acceptance 2: all {len(ref_set)} distinct required/supporting "
          f"items exist in service_catalog")

    n_sup = r.where(F.size("supporting_services") > 0).count()
    n_req = r.where(F.size("required_services") > 0).count()
    n_crit = r.where(F.col("critical")).count()
    print(f"rules with >=1 supporting item: {n_sup}/{len(cat_names)}; "
          f"with required items: {n_req}; critical: {n_crit}")

    print("\n=== curated corroboration rules (for human review) ===")
    (r.where(F.col("rule_source") == "curated")
     .select("service", "required_services", "supporting_services",
             "min_facility_class", "min_doctors", "critical")
     .orderBy("service").show(40, truncate=False))

    print("=== corroboration preview: curated services with required items ===")
    spark.sql(f"""
        WITH fsvc AS (
          SELECT unique_id, collect_set(service) AS svcs
          FROM {plat}.facility_service_evidence GROUP BY unique_id
        ), claims AS (
          SELECT f.unique_id, r.service, r.required_services, f.svcs
          FROM fsvc f
          JOIN {plat}.corroboration_rules r
            ON array_contains(f.svcs, r.service)
          WHERE r.rule_source = 'curated'
            AND size(r.required_services) > 0
        )
        SELECT service, COUNT(*) AS claims,
               SUM(CASE WHEN size(array_intersect(svcs, required_services))
                             = size(required_services)
                        THEN 1 ELSE 0 END) AS fully_corroborated
        FROM claims GROUP BY service ORDER BY claims DESC
    """).show(40, truncate=False)

    print("=== scale-consistency preview: suspicious neurosurgery claims ===")
    print("(plan §5 example: clinic-class facility claiming neurosurgery,"
          " or <=2 doctors)")
    spark.sql(f"""
        WITH fsvc AS (
          SELECT unique_id, collect_set(service) AS svcs
          FROM {plat}.facility_service_evidence GROUP BY unique_id
        )
        SELECT c.unique_id, fc.facility_class, fs.n_doctors
        FROM fsvc c
        JOIN {plat}.facility_class fc USING (unique_id)
        LEFT JOIN {plat}.facility_scale fs USING (unique_id)
        WHERE array_contains(c.svcs, 'neurosurgery')
          AND (fc.facility_class IS NULL
               OR fc.facility_class != 'hospital'
               OR COALESCE(fs.n_doctors, 0) <= 2)
        LIMIT 10
    """).show(10, truncate=False)


if __name__ == "__main__":  # pragma: no cover
    main()
