"""recommend.py -- TODOs 8-11: needs extraction, geo filter, ranking,
explanations.

The Phase 3 runtime of the facility recommender (plan §7):

    needs extraction (TODO 8)
        extract_needs(symptoms, context) -- one ai_query call to
        system.ai.gpt-oss-120b with temperature 0; raw JSON parsed and
        validated in Python, constrained to the 192-service canonical
        catalog (unknown service names are dropped and reported, never
        trusted).

    geo filter (TODO 9)
        geo_candidates(lat, lng, radius_km) -- haversine distance on
        gold.latitude_final/longitude_final. Centroid-imputed coordinates
        (_coordinates_source = 'pincode_centroid') are KEPT but flagged;
        the ranker applies a small multiplicative penalty (plan §7.2:
        penalize, never exclude). pincode_to_coords() resolves a user
        pincode via the gold pincode centroids.

    ranking (TODO 10)
        rank(needs, candidates) -- score = SUM(w_i * conf_score(band))
        over the need vector, conf_score: high 1.0 / medium 0.5 /
        unverified 0.3 / low 0.05 / no evidence 0.0. Critical needs are
        HARD FILTERS: a facility missing evidence for a critical need, or
        carrying band 'low' (scale violation) on it, is excluded. Tie-breakers
        (plan §7.3): NABH accreditation, bed count, facility class rank,
        distance. NFHS district-need alignment is deliberately excluded from
        the ranker by design (TODO 13 resolved the district mapping:
        188 facilities parent-mapped, 11 Purba Bardhaman NULL). Output
        carries a per-need `matched` map (service -> band).

    explanations (TODO 11)
        explain(spark, needs, ranked_rows) -- per-facility why-ranked dicts:
        each need's confidence band, corroborating channels, token counts,
        scale note, missing required items, and score contribution; rendered
        by render_explanation(). Facility-side facts come only from the
        platinum confidence/class/scale tables and the ranked output --
        every claim is verified evidence; unmatched needs are reported as
        'no evidence (unknown, not disproven)' per plan §5.

Run the acceptance battery (needs + geo + rank + explanation cases):
    import runpy
    mod = runpy.run_path("src/recommend.py")
    mod["main"]([])
"""

import argparse
import json
import os
import sys

from pyspark.sql import SparkSession
from pyspark.sql import functions as F

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from catalog import DEFAULT_TARGET_CATALOG  # noqa: E402
from ontology import CLASS_RANK  # noqa: E402

MODEL = "system.ai.gpt-oss-120b"
RADIUS_KM = 25          # default search radius for the acceptance battery
TOP_N = 5
CENTROID_PENALTY = 0.95  # multiplicative score penalty for centroid coords

PLAT = f"{DEFAULT_TARGET_CATALOG}.platinum"
GOLD = f"{DEFAULT_TARGET_CATALOG}.gold.facility_district_health_indicators"

CONF_SCORE = {"high": 1.0, "medium": 0.5, "unverified": 0.3, "low": 0.05}
CONF_SCORE_SQL = ("CASE confidence_band WHEN 'high' THEN 1.0 "
                   "WHEN 'medium' THEN 0.5 WHEN 'unverified' THEN 0.3 "
                   "WHEN 'low' THEN 0.05 ELSE 0.0 END")
CLASS_RANK_SQL = ("CASE facility_class "
                   + " ".join(f"WHEN '{k}' THEN {v}"
                              for k, v in CLASS_RANK.items())
                   + " ELSE NULL END")

NEEDS_CASES = [
    ("chest pain and shortness of breath, sweating",
     "58-year-old male, smoker, diabetic, on metformin", 28.6139, 77.2090),
    ("nine months pregnant, due in two weeks, wants a facility for delivery",
     "28-year-old female, second pregnancy", 19.0760, 72.8777),
    ("severe knee pain, doctor advised knee replacement surgery",
     "64-year-old female, overweight, hypertension", 30.9010, 75.8573),
    ("child with high fever and rash for three days",
     "4-year-old, lethargic, not eating", 13.0827, 80.2707),
    ("kidney failure, needs regular dialysis",
     "52-year-old male, diabetic nephropathy", 17.3850, 78.4867),
    ("blurred vision, floaters, elderly diabetic",
     "61-year-old, type 2 diabetes for 15 years", 22.5726, 88.3639),
    ("severe toothache, swollen gum",
     "35-year-old male", 18.5204, 73.8567),
    ("trying to conceive for three years, wants evaluation",
     "31-year-old female, irregular periods; husband 34", 23.0225, 72.5714),
    ("diagnosed coronary artery disease, advised bypass surgery",
     "56-year-old male, three-vessel disease", 26.9124, 75.7873),
    ("routine health checkup with blood tests wanted",
     "40-year-old, no symptoms, annual screening", 12.9716, 77.5946),
]


def _parse_json(text):
    """Defensively parse the model's JSON array of needs."""
    t = str(text).strip()
    if t.startswith("```"):
        t = t.strip("`")
        if t.startswith("json"):
            t = t[4:]
        t = t.strip()
    i, j = t.find("["), t.rfind("]")
    if i >= 0 and j > i:
        t = t[i:j + 1]
    return json.loads(t)


def _catalog_text(spark):
    rows = (spark.table(f"{PLAT}.service_catalog")
            .select("service_type", "service_name").collect())
    by_type = {}
    for r in rows:
        by_type.setdefault(r["service_type"], []).append(r["service_name"])
    return "\n".join(f"{t}: " + ", ".join(sorted(v))
                     for t, v in sorted(by_type.items()))


def extract_needs(spark, symptoms, context=""):
    """LLM: symptoms + context -> weighted need vector over the catalog.

    Returns (needs, unknown): needs is a list of dicts
    {service, weight, critical}, unknown holds catalog-miss service names
    the model returned (dropped, reported -- never trusted).
    """
    prompt = (
        "You are a clinical triage assistant. Map the patient query to a "
        "weighted need vector over this facility-service catalog.\n\n"
        "Catalog (use ONLY these exact service names, spelled exactly):\n"
        + _catalog_text(spark) + "\n\n"
        f"Patient symptoms: {symptoms}\n"
        f"Patient context: {context or 'none given'}\n\n"
        "Output ONLY a JSON array (no prose, no markdown) with 1 to 8 "
        "items, each exactly {'service': string, 'weight': number, "
        "'critical': boolean} -- valid JSON with double quotes. "
        "For each need:\n"
        "- service: an exact catalog name above.\n"
        "- weight: 0.0-1.0 importance. The single primary need gets 1.0; "
        "directly supporting services 0.3-0.6; contextual extras 0.1-0.3.\n"
        "- critical: true for a must-have -- emergency care, the core "
        "surgical procedure, or the treatment the patient explicitly "
        "needs (dialysis, delivery); false for nice-to-have extras.\n"
    )
    spark.createDataFrame([(prompt,)], "prompt STRING") \
         .createOrReplaceTempView("needs_prompt")
    res = spark.sql(f"""
        SELECT ai_query('{MODEL}', prompt,
            modelParameters => named_struct('temperature', 0),
            failOnError => false) AS out
        FROM needs_prompt
    """).collect()[0]["out"]
    d = res.asDict() if hasattr(res, "asDict") else {"result": res}
    if d.get("errorMessage"):
        raise RuntimeError(f"ai_query failed: {d['errorMessage']}")
    raw = _parse_json(d["result"])

    catalog = {r["service_name"] for r in
               spark.table(f"{PLAT}.service_catalog")
               .select("service_name").collect()}
    needs, unknown, seen = [], [], {}
    for r in raw:
        svc = str(r.get("service") or "").strip()
        w = min(max(float(r.get("weight") or 0.0), 0.0), 1.0)
        crit = bool(r.get("critical"))
        if svc not in catalog:
            unknown.append(svc)
            continue
        if svc in seen:
            prev = seen[svc]
            prev["weight"] = max(prev["weight"], w)
            prev["critical"] = prev["critical"] or crit
            continue
        item = {"service": svc, "weight": round(w, 3), "critical": crit}
        seen[svc] = item
        needs.append(item)
    if not needs:
        raise RuntimeError(f"needs extraction returned no catalog services; "
                           f"unknown={unknown}")
    return sorted(needs, key=lambda x: (-x["weight"], x["service"])), unknown


def pincode_to_coords(spark, pincode):
    """Resolve a user pincode to centroid coords from the gold table."""
    pin = int(pincode)
    rows = spark.sql(f"""
        SELECT DISTINCT centroid_lat, centroid_lon FROM {GOLD}
        WHERE pincode = {pin} AND centroid_lat IS NOT NULL
    """).collect()
    if not rows:
        return None
    return rows[0]["centroid_lat"], rows[0]["centroid_lon"]


def geo_candidates(spark, lat, lng, radius_km):
    """Haversine radius filter; centroid coords kept and flagged (§7.2)."""
    la, lo = repr(float(lat)), repr(float(lng))
    return spark.sql(f"""
        SELECT unique_id, name, pincode,
               latitude_final, longitude_final,
               _coordinates_source AS coord_source,
               6371.0 * 2 * asin(sqrt(
                 pow(sin(radians(latitude_final - {la}) / 2), 2) +
                 cos(radians({la})) * cos(radians(latitude_final)) *
                 pow(sin(radians(longitude_final - {lo}) / 2), 2)))
                   AS distance_km
        FROM {GOLD}
        WHERE latitude_final IS NOT NULL AND longitude_final IS NOT NULL
    """).where(F.col("distance_km") <= float(radius_km))


def rank(spark, needs, candidates, top_n=TOP_N):
    """Sigma w*conf with critical-need hard filters and §7 tie-breakers."""
    spark.createDataFrame(
        [(n["service"], float(n["weight"]), bool(n["critical"])) for n in needs],
        "service STRING, weight DOUBLE, critical BOOLEAN") \
        .createOrReplaceTempView("needs")
    candidates.createOrReplaceTempView("cand")
    ranked = spark.sql(f"""
        WITH pairs AS (
          SELECT c.unique_id, c.name, c.coord_source, c.distance_km,
                 fc.facility_class, fs.capacity_value AS beds,
                 nb.unique_id IS NOT NULL AS nabh,
                 n.service, n.weight, n.critical,
                 cf.confidence_band
          FROM cand c
          CROSS JOIN needs n
          LEFT JOIN {PLAT}.facility_service_confidence cf
            ON cf.unique_id = c.unique_id AND cf.service = n.service
          LEFT JOIN {PLAT}.facility_class fc ON c.unique_id = fc.unique_id
          LEFT JOIN {PLAT}.facility_scale fs ON c.unique_id = fs.unique_id
          LEFT JOIN (SELECT DISTINCT unique_id FROM
                     {PLAT}.facility_service_confidence
                     WHERE service = 'nabhAccredited') nb
            ON c.unique_id = nb.unique_id
        ),
        crit_fail AS (
          SELECT unique_id FROM pairs
          WHERE critical AND NOT (confidence_band IN ('high', 'medium'))
          GROUP BY unique_id
        )
        SELECT
          unique_id,
          max(name)            AS name,
          max(facility_class)  AS facility_class,
          max(distance_km)     AS distance_km,
          max(coord_source)    AS coord_source,
          max(nabh)            AS nabh,
          max(beds)            AS beds,
          SUM(weight * {CONF_SCORE_SQL}) AS raw_score,
          SUM(CASE WHEN confidence_band IS NOT NULL THEN 1 ELSE 0 END)
                               AS n_needs_met,
          map_from_entries(collect_list(struct(
            service, coalesce(confidence_band, 'no_evidence')))) AS matched,
          SUM(weight * {CONF_SCORE_SQL}) * CASE
            WHEN max(coord_source) = 'pincode_centroid'
              THEN {CENTROID_PENALTY} ELSE 1.0 END AS score
        FROM pairs
        WHERE unique_id NOT IN (SELECT unique_id FROM crit_fail)
        GROUP BY unique_id
    """)
    ranked.createOrReplaceTempView("ranked_view")
    return spark.sql(f"""
        SELECT unique_id, name, facility_class, ROUND(distance_km, 1) AS km,
               nabh, beds, ROUND(score, 3) AS score, n_needs_met, matched
        FROM ranked_view
        ORDER BY score DESC, nabh DESC, beds DESC,
                 {CLASS_RANK_SQL} DESC NULLS LAST, km ASC
        LIMIT {int(top_n)}
    """)


def explain(spark, needs, ranked_rows):
    """Per-facility why-ranked explanations (TODO 11).

    Facility-side facts (band, channels, token counts, scale note, missing
    required items, NABH, beds, distance, class) come only from the platinum
    confidence/class/scale tables and the ranked output; unmatched needs are
    reported as unknown (plan §5: never disproof). Returns one dict per
    ranked facility, in rank order.
    """
    spark.createDataFrame(
        [(r["unique_id"],) for r in ranked_rows], "unique_id STRING") \
        .createOrReplaceTempView("top_facs")
    spark.createDataFrame(
        [(n["service"], float(n["weight"]), bool(n["critical"]))
         for n in needs],
        "service STRING, weight DOUBLE, critical BOOLEAN") \
        .createOrReplaceTempView("needs")
    detail = spark.sql(f"""
        SELECT t.unique_id, n.service, n.weight, n.critical,
               cf.confidence_band, cf.channels, cf.n_tokens_total,
               cf.scale_note, cf.required_missing
        FROM top_facs t
        CROSS JOIN needs n
        LEFT JOIN {PLAT}.facility_service_confidence cf
          ON cf.unique_id = t.unique_id AND cf.service = n.service
    """).collect()
    per = {}
    for d in detail:
        per.setdefault(d["unique_id"], {})[d["service"]] = d
    out = []
    for pos, r in enumerate(ranked_rows, 1):
        uid = r["unique_id"]
        fneeds, unmet = [], []
        for n in needs:
            d = per.get(uid, {}).get(n["service"])
            if d is None or d["confidence_band"] is None:
                unmet.append(n["service"])
                continue
            band = d["confidence_band"]
            fneeds.append({
                "service": n["service"], "weight": n["weight"],
                "critical": n["critical"], "band": band,
                "channels": sorted(d["channels"] or []),
                "n_tokens": d["n_tokens_total"] or 0,
                "scale_note": d["scale_note"] or "",
                "required_missing": list(d["required_missing"] or []),
                "contribution": round(
                    n["weight"] * CONF_SCORE.get(band, 0.0), 3)})
        out.append({"rank": pos, "unique_id": uid, "name": r["name"],
                    "facility_class": r["facility_class"],
                    "distance_km": r["km"], "nabh": r["nabh"],
                    "beds": r["beds"], "score": r["score"],
                    "needs": fneeds, "unmet": unmet})
    return out


def render_explanation(f):
    """Render one explanation dict as a compact multi-line string."""
    head = (f"#{f['rank']} {f['name']} "
            f"({f['facility_class'] or 'unclassified'}, {f['distance_km']} km, "
            f"score {f['score']}")
    if f["nabh"]:
        head += ", NABH-accredited"
    lines = ["  " + head + ")"]
    for n in sorted(f["needs"], key=lambda x: (-x["weight"], x["service"])):
        s = (f"  - {n['service']} (w={n['weight']:.2f}"
             + (" CRITICAL" if n["critical"] else "")
             + f") contributes {n['contribution']}: {n['band']} band via "
             + "+".join(n["channels"]))
        if n["n_tokens"]:
            s += f" [{n['n_tokens']} tokens]"
        if n["scale_note"]:
            s += f" [{n['scale_note']}]"
        if n["required_missing"]:
            s += " [missing required: " + ", ".join(n["required_missing"]) + "]"
        lines.append(s)
    if f["unmet"]:
        lines.append("  - no evidence found for: " + ", ".join(f["unmet"])
                     + " (unknown, not disproven)")
    return "\n".join(lines)


def recommend(spark, lat, lng, radius_km, symptoms, context="", top_n=TOP_N):
    """Full §7 flow: needs -> geo -> rank. Returns (needs, ranked_df)."""
    needs, _unknown = extract_needs(spark, symptoms, context)
    cand = geo_candidates(spark, lat, lng, radius_km)
    return needs, rank(spark, needs, cand, top_n)


def _print_case(idx, symptoms, context, needs, unknown):
    crit = [n["service"] for n in needs if n["critical"]]
    txt = ", ".join(f"{n['service']}(w={n['weight']}"
                    f"{', crit' if n['critical'] else ''})" for n in needs)
    print(f"case {idx}: {symptoms}")
    print(f"  needs: {txt}")
    if crit:
        print(f"  critical: {crit}")
    if unknown:
        print(f"  DROPPED unknown services: {unknown}")


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.parse_args(argv)
    spark = SparkSession.builder.getOrCreate()

    print("=== TODO 8 acceptance: 10 diverse needs extractions ===")
    all_unknown = []
    for i, (sym, ctx, _la, _lo) in enumerate(NEEDS_CASES, 1):
        needs, unknown = extract_needs(spark, sym, ctx)
        all_unknown += unknown
        _print_case(i, sym, ctx, needs, unknown)
    assert not all_unknown, f"off-catalog service names: {all_unknown}"
    print("acceptance: all 10 vectors use only catalog services; "
          "0 unknown names")

    print("\n=== TODO 9 acceptance: known pincode + radius ===")
    pin = spark.sql(f"""
        SELECT pincode, COUNT(*) AS n FROM {GOLD}
        WHERE pincode IS NOT NULL GROUP BY pincode
        ORDER BY n DESC LIMIT 1
    """).collect()[0]
    coords = pincode_to_coords(spark, pin["pincode"])
    print(f"densest pincode {pin['pincode']} ({pin['n']} facilities) -> "
          f"centroid {coords}")
    cand = geo_candidates(spark, coords[0], coords[1], 10)
    cand.createOrReplaceTempView("geo_cand")
    n_cand = cand.count()
    spark.sql("""
        SELECT coord_source, COUNT(*) AS n FROM geo_cand GROUP BY 1 ORDER BY 2 DESC
    """).show()
    print("--- 10 nearest facilities (same pincode should dominate) ---")
    spark.sql(f"""
        SELECT name, pincode, coord_source, ROUND(distance_km, 1) AS km
        FROM geo_cand ORDER BY distance_km LIMIT 10
    """).show(10, truncate=45)
    spark.sql(f"""
        WITH near AS (SELECT * FROM geo_cand ORDER BY distance_km LIMIT 10)
        SELECT SUM(CASE WHEN pincode = {int(pin['pincode'])}
                        THEN 1 ELSE 0 END) AS same_pincode_in_10_nearest
        FROM near
    """).show()

    print("\n=== TODO 10 acceptance: 10 ranked recommendations ===")
    n_explained = 0
    for i, (sym, ctx, la, lo) in enumerate(NEEDS_CASES, 1):
        needs, ranked = recommend(spark, la, lo, RADIUS_KM, sym, ctx)
        _print_case(i, sym, ctx, needs, [])
        rows = ranked.collect()
        assert rows, f"case {i}: no facility passed the hard filters"
        for r in rows:
            for n in needs:
                if n["critical"] and r["matched"].get(n["service"]) == "low":
                    raise AssertionError(
                        f"case {i}: facility {r['unique_id']} has band 'low' "
                        f"on critical need {n['service']}")
        print("  top-5:")
        for r in rows:
            bands = " ".join(f"{s}={b}" for s, b in r["matched"].items())
            print(f"    {r['name'][:44]:44s} {r['facility_class'] or '?':10s} "
                  f"{r['km']:5.1f}km score={r['score']:.3f} "
                  f"nabh={r['nabh']} {bands}")
        exps = explain(spark, needs, rows)
        assert len(exps) == len(rows), f"case {i}: explanation count mismatch"
        for f, r in zip(exps, rows):
            assert len(f["needs"]) + len(f["unmet"]) == len(needs), (
                f"case {i}: facility {r['unique_id']} explanation incomplete")
            for n in f["needs"]:
                assert r["matched"].get(n["service"]) == n["band"], (
                    f"case {i}: band mismatch for {n['service']}")
                assert n["band"] in CONF_SCORE and n["channels"], (
                    f"case {i}: unverified claim for {n['service']}")
            for s in f["unmet"]:
                assert r["matched"].get(s) == "no_evidence"
        n_explained += len(exps)
        print("  why-ranked (top-2 of 5):")
        for f in exps[:2]:
            print(render_explanation(f))
        print()
    print("acceptance: no facility with band 'low' on a critical need "
          "appears in any top-5 (asserted per case)")
    print(f"acceptance: all {n_explained} recommended facilities carry "
          "explanations built only from platinum tables; bands/channels "
          "cross-checked against the ranker's matched map (two independent "
          "join paths)")


if __name__ == "__main__":  # pragma: no cover
    main()
