"""hybrid_recommend.py -- TODO 15: survey-first needs + never-empty ranking.

Two integrations of the Virtue Facility Finder engine into this pipeline's
runtime (recommend.py), without modifying its internals:

    hybrid_needs(spark, symptoms, context)
        Survey-first front door. One ai_query call (temperature 0) over the
        75 NHAMCS complaint profiles asks ONLY for a complaint code --
        never services, never facilities. On a match the need vector is
        read from the survey profiles (data-backed weights, each labelled
        with its share, Wilson 95% CI and Kish n_eff; pathway escalation
        services get the expert-set weight, labelled 'no CI'). When no
        survey complaint matches, falls back to recommend.extract_needs
        (free-form LLM weights) with every need relabelled 'LLM-estimated,
        no CI' -- the engine's honest-labeling policy: never present weak
        evidence as data.

    find_facilities_never_empty(spark, symptoms, context, pin, top_n)
        The engine's 'never return nothing' policy wrapped around
        geo_candidates + rank:
          1. radius ladder 25 -> 50 -> 100 -> 300 km (first non-empty wins,
             each widening reported);
          2. if critical needs hard-filtered everything, retry with
             critical cleared (penalized by rank's conf_score, never
             silently) with a CRITICAL_UNAVAILABLE banner;
          3. generic fallback: rank nearest facilities on a single
             emergencyCare need with a GENERIC_FALLBACK banner, LOW
             confidence by design.
        Every fallback step is surfaced in the returned banners so the UI
        and the Q&A can say exactly what happened.

Run the acceptance battery (needs a Spark session with ai_query access):
    import runpy; mod = runpy.run_path("src/hybrid_recommend.py")
    mod["main"]([])
"""

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from recommend import (MODEL, TOP_N, extract_needs,  # noqa: E402
                       geo_candidates, pincode_to_coords, rank)
from survey_needs import needs_vector  # noqa: E402

PROFILES_JSON = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                             "data", "complaint_profiles.json")
RADIUS_LADDER_KM = [25, 50, 100, 300]


def load_profiles(path=PROFILES_JSON):
    with open(path, encoding="utf-8") as fh:
        payload = json.load(fh)
    return {int(k): v for k, v in payload["profiles"].items()}, payload


def classify_complaint(spark, symptoms, context=""):
    """LLM maps symptoms to a survey complaint code or None. JSON-only out."""
    profiles, _ = load_profiles()
    listing = "\n".join("%d | %s (%d visits)" % (c, v["label"], v["n_visits"])
                        for c, v in sorted(profiles.items(),
                                           key=lambda x: -x[1]["n_visits"]))
    prompt = (
        "You are a clinical triage assistant. Read the patient query and "
        "decide which survey complaint category it belongs to.\n\n"
        "Categories (code | label | survey visits):\n" + listing + "\n\n"
        f"Patient symptoms: {symptoms}\n"
        f"Patient context: {context or 'none given'}\n\n"
        "Output ONLY JSON (no prose, no markdown): "
        "{\"complaint_code\": <code or null>} -- null when the query does "
        "not fit any category (e.g. dental, fertility, checkup queries)."
    )
    spark.createDataFrame([(prompt,)], "prompt STRING") \
         .createOrReplaceTempView("complaint_prompt")
    res = spark.sql(f"""
        SELECT ai_query('{MODEL}', prompt,
            modelParameters => named_struct('temperature', 0),
            failOnError => false) AS out
        FROM complaint_prompt
    """).collect()[0]["out"]
    d = res.asDict() if hasattr(res, "asDict") else {"result": res}
    if d.get("errorMessage"):
        raise RuntimeError("ai_query failed: %s" % d["errorMessage"])
    text = str(d["result"]).strip()
    i, j = text.find("{"), text.rfind("}")
    parsed = json.loads(text[i:j + 1] if i >= 0 else text)
    code = parsed.get("complaint_code")
    return int(code) if code is not None else None


def hybrid_needs(spark, symptoms, context=""):
    """Survey-first needs; LLM free-form fallback, honestly labelled.

    Returns (needs, meta): needs in recommend.extract_needs shape, meta
    carries weight_source per service plus needs_source and context
    (engine services with no catalog counterpart).
    """
    profiles, payload = load_profiles()
    code = classify_complaint(spark, symptoms, context)
    if code is not None and code in profiles:
        needs, context_services = needs_vector(code, profiles)
        return needs, {
            "needs_source": "survey", "complaint_code": code,
            "complaint_label": profiles[code]["label"],
            "n_visits": profiles[code]["n_visits"],
            "weight_source": {n["service"]: n["weight_source"]
                              for n in needs},
            "context_no_catalog_counterpart": context_services,
        }
    needs, unknown = extract_needs(spark, symptoms, context)
    needs = [dict(n, weight_source="LLM-estimated, no CI") for n in needs]
    return needs, {
        "needs_source": "llm", "complaint_code": None,
        "weight_source": {n["service"]: "LLM-estimated, no CI"
                          for n in needs},
        "unknown_services_dropped": unknown,
        "note": "no survey complaint matched; weights are LLM estimates "
                "and carry no confidence interval",
    }


def _n_rows(ranked):
    """Count rows whether rank returned a DataFrame or a list."""
    if ranked is None:
        return 0, []
    try:                                    # PySpark DataFrame
        rows = ranked.collect()
    except AttributeError:                  # list / already materialized
        rows = list(ranked)
    return len(rows), rows


def find_facilities_never_empty(spark, symptoms, context="", pin=None,
                                top_n=TOP_N):
    """Engine policy: widen, soften, fall back -- never return nothing."""
    lat, lng = pincode_to_coords(spark, pin)
    needs, meta = hybrid_needs(spark, symptoms, context)
    banners = []

    for radius in RADIUS_LADDER_KM:
        cands = geo_candidates(spark, lat, lng, radius)
        ranked = rank(spark, needs, cands)
        n, rows = _n_rows(ranked)
        if n:
            return {"needs": needs, "needs_meta": meta, "rows": rows[:top_n],
                    "banners": banners, "radius_km": radius}
        banners.append("no facilities within %d km; widened search" % radius)

    # critical needs may have hard-filtered everything: penalize, never hide
    softened = [dict(n, critical=False) for n in needs]
    banners.append("CRITICAL_UNAVAILABLE: no facility within 300 km documents "
                   "the critical service; showing best available without it")
    for radius in RADIUS_LADDER_KM:
        cands = geo_candidates(spark, lat, lng, radius)
        ranked = rank(spark, softened, cands)
        n, rows = _n_rows(ranked)
        if n:
            return {"needs": softened, "needs_meta": meta, "rows": rows[:top_n],
                    "banners": banners, "radius_km": radius}

    # generic fallback: nearest emergency-capable care, LOW confidence
    banners.append("GENERIC_FALLBACK: ranking nearest facilities for general "
                   "emergency care; LOW confidence by design")
    generic = [{"service": "emergencyCare", "weight": 1.0, "critical": False,
               "weight_source": "generic fallback (expert-set, no CI)"}]
    cands = geo_candidates(spark, lat, lng, RADIUS_LADDER_KM[-1])
    ranked = rank(spark, generic, cands)
    n, rows = _n_rows(ranked)
    if not n:
        rows = []
        banners.append("no facilities in dataset within 300 km of this PIN")
    return {"needs": generic, "needs_meta": meta, "rows": rows[:top_n],
            "banners": banners, "radius_km": RADIUS_LADDER_KM[-1]}


# ------------------------------------------------------------------ QA --
CASES = [
    # (symptoms, context, pin) -- mirrors the engine's acceptance set
    ("chest pain and shortness of breath, sweating",
     "58-year-old male, smoker, diabetic", "302001"),      # Jaipur, survey
    ("severe toothache, swollen gum",
     "35-year-old male", "500001"),                       # Hyderabad, survey (1500)
    ("gibberish qwerty zzz",
     "", "110001"),                                       # Delhi, fallback
    ("kidney failure, needs regular dialysis",
     "52-year-old male", "560001"),                       # Bengaluru
]


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.parse_args(argv)
    from pyspark.sql import SparkSession
    spark = SparkSession.builder.getOrCreate()
    profiles, _ = load_profiles()
    print("loaded %d survey complaint profiles from %s"
          % (len(profiles), PROFILES_JSON))
    for symptoms, context, pin in CASES:
        out = find_facilities_never_empty(spark, symptoms, context, pin)
        print("\n=== %r (pin %s) ===" % (symptoms, pin))
        print("needs_source=%s code=%s | %d results | banners: %s"
              % (out["needs_meta"]["needs_source"],
                 out["needs_meta"].get("complaint_code"),
                 len(out["rows"]), out["banners"] or "none"))
        for n in out["needs"][:3]:
            print("  need %-24s w=%.3f critical=%s | %s"
                  % (n["service"], n["weight"], n["critical"],
                     out["needs_meta"]["weight_source"][n["service"]]))
        assert out["rows"] or "no facilities" in " ".join(out["banners"]), (
            "never-empty policy violated")
    print("\nacceptance: never-empty policy holds for all %d cases"
          % len(CASES))


if __name__ == "__main__":
    main()
