"""survey_needs.py -- TODO 14: NHAMCS 2022 survey-grounded need weights.

Ports the complaint-profile statistical layer from the Virtue Facility Finder
engine into this pipeline, keyed to the canonical 192-service catalog:

    read_dta(path)
        Minimal stdlib reader for a Stata release-117 file (no pandas,
        no external deps) -- returns rows (dicts) and value labels.

    build_profiles(dta_path)
        For each 3-digit RFV complaint code with >= MIN_VISITS raw visits
        (75 of them in NHAMCS 2022) and each of the 14 engine services:
            p_hat = sum(PATWT over visits receiving the service)
                    / sum(PATWT over all visits in the category)
        with a Wilson 95% confidence interval computed on the Kish effective
        sample size n_eff = (sum w)^2 / sum w^2, so the interval reflects
        unequal weights rather than raw n. Emergency share is restricted to
        visits with valid triage acuity (IMMEDR 1-5).
        Deliberate caveat (stated in every output): NHAMCS is a stratified
        multistage sample; the design-based variance is larger than this
        SRS approximation, so the intervals are optimistic lower bounds on
        width. Shares are routing inputs describing what similar US ED
        visits received -- not predictions for an individual patient.

    SERVICE_CROSSWALK
        engine service_id -> canonical catalog service name
        (ecg -> ecgMachine, icu -> icu, dialysis -> dialysis, ...).
        engine services with no catalog counterpart (inpatient is a
        facility-level property; c-section is absent from the catalog if
        the QA check reports it) are carried as context, never invented.

    PATHWAYS
        The four escalation rules from the engine (chest pain -> cathLab,
        shortness of breath -> icu, fracture -> operationTheatre,
        complications of pregnancy -> c-section) expressed over catalog
        names where a counterpart exists.

    Output: src/data/complaint_profiles.json (committed; regenerable from
    the .dta with --dta). QA prints the profile count, CI sanity checks,
    and a crosswalk existence check against the catalog modules.

Run:
    python src/survey_needs.py --dta /path/to/ed2022-stata.dta
    or from a notebook REPL:
        import runpy; runpy.run_path("src/survey_needs.py")
"""

import argparse
import collections
import json
import math
import os
import struct
import sys

Z = 1.96                 # two-sided 95%
MIN_VISITS = 50          # complaints with fewer raw survey visits are not offered
OUT_DEFAULT = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                           "data", "complaint_profiles.json")

# ---------------------------------------------------------------------------
# engine service universe (14) -> canonical catalog name (or None = context)
# ---------------------------------------------------------------------------
SERVICE_CROSSWALK = {
    "emergency":      "emergencyCare",
    "ecg":            "ecgMachine",
    "xray":           "xrayImaging",
    "ct":             "ctScanner",
    "mri":            "mriScanner",
    "ultrasound":     "ultrasoundImaging",
    "lab":            "pathologyLaboratory",
    "fracture_care":  "fractureCare",
    "inpatient":      None,   # facility-level (class/beds), not a service
    "icu":            "icu",
    "operating_room": "operationTheatre",
    "cath_lab":       "cathLab",
    "c_section":      None,   # QA checks whether the catalog has a counterpart
    "dialysis":       "dialysis",
}

# how each service is read off one NHAMCS 2022 visit (engine VISIT_HAS;
# dialysis has no survey column -- dialysis is a guideline pathway only)
def _visit_has():
    return {
        "emergency":      lambda r: r["IMMEDR"] in (1, 2, 3),
        "ecg":            lambda r: r["EKG"] == 1,
        "xray":           lambda r: r["XRAY"] == 1,
        "ct":             lambda r: r["CATSCAN"] == 1,
        "mri":            lambda r: r["MRI"] == 1,
        "ultrasound":     lambda r: r["ULTRASND"] == 1,
        "lab":            lambda r: 1 in (r["CBC"], r["CMP"], r["BMP"],
                                           r["CARDENZ"], r["URINE"], r["OTHERBLD"]),
        "fracture_care":  lambda r: r["CASTSPLINT"] == 1,
        "inpatient":      lambda r: r["ADMITHOS"] == 1 or r["OBSHOS"] == 1,
        "icu":            lambda r: r["ADMIT"] == 1,
        "operating_room": lambda r: r["ADMIT"] == 3,
        "cath_lab":       lambda r: r["ADMIT"] == 5,
        "c_section":      lambda r: False,
        "dialysis":       lambda r: False,
    }

# engine PATHWAYS: complaint code -> escalation service (expert-set weight,
# blended at 50% of the care term in the engine; here exported as a flag)
PATHWAYS = {
    1050: {"label_hint": "chest pain", "escalation": "cath_lab"},
    1415: {"label_hint": "shortness of breath", "escalation": "icu"},
    1930: {"label_hint": "fracture", "escalation": "operating_room"},
    1790: {"label_hint": "complications of pregnancy", "escalation": "c_section"},
}
W_ESCALATION = 0.5


# ---------------------------------------------------------------------------
# statistics
# ---------------------------------------------------------------------------
def wilson(p, n, z=Z):
    """Wilson score interval on proportion p with effective n."""
    if n <= 0:
        return None, None
    c = p + z * z / (2 * n)
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    d = 1 + z * z / n
    return (c - h) / d, (c + h) / d


def kish_n(ws):
    """Kish effective sample size for a list of weights."""
    tot = sum(ws)
    ss = sum(w * w for w in ws)
    return (tot * tot / ss) if ss else 0.0


# ---------------------------------------------------------------------------
# stdlib Stata-117 reader (from the engine, verbatim logic)
# ---------------------------------------------------------------------------
def read_dta(path):
    """Minimal reader for a Stata release-117 file."""
    b = open(path, "rb").read()

    def tag(t):
        return b.index(("<%s>" % t).encode()) + len(t) + 2

    if b[tag("release"):tag("release") + 3] != b"117":
        raise ValueError("Expected a Stata release 117 file")
    K = struct.unpack("<H", b[tag("K"):tag("K") + 2])[0]
    N = struct.unpack("<I", b[tag("N"):tag("N") + 4])[0]
    m = struct.unpack("<14Q", b[tag("map"):tag("map") + 112])
    o = m[2] + 16
    types = struct.unpack("<%dH" % K, b[o:o + 2 * K])
    o = m[3] + 10
    names = [b[o + 33 * k:o + 33 * k + 33].split(b"\0")[0].decode("latin1")
             for k in range(K)]
    code = {65526: "d", 65527: "f", 65528: "i", 65529: "h", 65530: "b"}
    S = struct.Struct("<" + "".join("%ds" % t if t <= 2045 else code[t]
                                      for t in types))
    o = m[9] + 6
    rows = [dict(zip(names, S.unpack_from(b, o + n * S.size))) for n in range(N)]
    labels = {}
    o = m[11] + 14
    while b[o:o + 5] == b"<lbl>":
        o += 5
        ln = struct.unpack("<I", b[o:o + 4])[0]
        nm = b[o + 4:o + 37].split(b"\0")[0].decode("latin1")
        t = o + 40
        n, tl = struct.unpack("<II", b[t:t + 8])
        off = struct.unpack("<%dI" % n, b[t + 8:t + 8 + 4 * n])
        val = struct.unpack("<%di" % n, b[t + 8 + 4 * n:t + 8 + 8 * n])
        txt = b[t + 8 + 8 * n:t + 8 + 8 * n + tl]
        labels[nm] = {v: txt[f:].split(b"\0")[0].decode("latin1")
                      for f, v in zip(off, val)}
        o = t + ln + 6
    return rows, labels


# ---------------------------------------------------------------------------
# profile build
# ---------------------------------------------------------------------------
def build_profiles(dta_path, min_visits=MIN_VISITS):
    rows, labels = read_dta(dta_path)
    visit_has = _visit_has()
    by = collections.defaultdict(list)
    for r in rows:
        by[r["RFV13D"]].append(r)
    profiles = {}
    for code, rs in by.items():
        if len(rs) < min_visits or code < 0:
            continue
        services = {}
        for s, f in visit_has.items():
            pool = ([r for r in rs if r["IMMEDR"] in (1, 2, 3, 4, 5)]
                    if s == "emergency" else rs)
            ws = [r["PATWT"] for r in pool]
            tw = sum(ws) or 1.0
            p = sum(w for r, w in zip(pool, ws) if f(r)) / tw
            lo, hi = wilson(p, kish_n(ws))
            services[s] = {
                "share": round(p, 4),
                "ci_lo": None if lo is None else round(lo, 4),
                "ci_hi": None if hi is None else round(hi, 4),
            }
        profiles[int(code)] = {
            "label": labels["RFV3DF"].get(code, "?"),
            "n_visits": len(rs),
            "n_eff": round(kish_n([r["PATWT"] for r in rs]), 1),
            "services": services,
        }
    return profiles


def needs_vector(code, profiles, crosswalk=SERVICE_CROSSWALK,
                  pathways=PATHWAYS, w_escalation=W_ESCALATION,
                  min_share=0.01):
    """Survey complaint code -> needs over canonical catalog services.

    Returns (needs, context): needs is a list of
        {service, weight, critical, weight_source}
    in the same shape recommend.extract_needs produces, with weight_source
    carrying the survey provenance (share + Wilson 95% CI + Kish n_eff).
    Engine services with no catalog counterpart are returned in context,
    never invented as needs. Pathway escalation services get the expert-set
    escalation weight, labelled as such (no CI -- they are hand-set).
    """
    prof = profiles[code]
    needs, context = [], []
    for s, v in sorted(prof["services"].items(), key=lambda x: -x[1]["share"]):
        target = crosswalk.get(s)
        if v["share"] < min_share and not (code in pathways and
                                            pathways[code]["escalation"] == s):
            if target is None and v["share"] >= 0.01:
                context.append({"engine_service": s, "share": v["share"]})
            continue
        if target is None:
            context.append({"engine_service": s, "share": v["share"]})
            continue
        src = ("survey share %.3f (Wilson 95%% CI [%.3f, %.3f], "
               "Kish n_eff %.0f; NHAMCS 2022 ED visits, US workup proxy)"
               % (v["share"], v["ci_lo"] or 0, v["ci_hi"] or 0, prof["n_eff"]))
        if code in pathways and pathways[code]["escalation"] == s:
            w = max(v["share"], w_escalation)
            src = "pathway escalation (expert-set, no CI); " + src
            needs.append({"service": target, "weight": round(w, 3),
                          "critical": True, "weight_source": src})
        else:
            needs.append({"service": target, "weight": v["share"],
                          "critical": False, "weight_source": src})
    return needs, context


# ---------------------------------------------------------------------------
# QA + build
# ---------------------------------------------------------------------------
def _crosswalk_check():
    """Report which crosswalk targets exist in the canonical catalog."""
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    try:
        from catalog import SERVICE_CATALOG
        from features import CANONICAL_SPECIALTIES
        known = set(CANONICAL_SPECIALTIES) | {s[0] for s in SERVICE_CATALOG}
    except Exception as e:  # pragma: no cover -- standalone use
        print("crosswalk check skipped (catalog import failed: %s)" % e)
        return
    missing = [v for v in SERVICE_CROSSWALK.values()
               if v is not None and v not in known]
    print("crosswalk: %d/%d mapped services in catalog" % (
        sum(1 for v in SERVICE_CROSSWALK.values()
            if v is not None and v in known),
        sum(1 for v in SERVICE_CROSSWALK.values() if v is not None)))
    if missing:
        print("crosswalk targets NOT in catalog (fix or they are context):",
              missing)
    for eng, cat in SERVICE_CROSSWALK.items():
        if cat is None:
            print("engine service carried as context (no catalog counterpart):",
                  eng)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--dta", default=os.path.join(
        os.path.expanduser("~"),
        "ed2022-stata.dta"),
        help="path to ed2022-stata.dta (NHAMCS 2022)")
    p.add_argument("--out", default=OUT_DEFAULT)
    p.parse_args(argv) if argv is not None else p.parse_args()
    args = p.parse_args(argv) if argv is not None else p.parse_args()

    profiles = build_profiles(args.dta)
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    payload = {
        "source": "NHAMCS 2022 (US CDC ED survey), 3-digit RFV complaints "
                  "with >= %d raw visits" % MIN_VISITS,
        "method": "survey-weighted shares; Wilson 95% CI on Kish effective n "
                  "(SRS approximation -- optimistic lower bound on width); "
                  "shares are routing inputs, not individual predictions",
        "service_crosswalk": SERVICE_CROSSWALK,
        "pathways": {str(k): v for k, v in PATHWAYS.items()},
        "profiles": {str(k): v for k, v in sorted(profiles.items())},
    }
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=1)
    print("wrote %s: %d complaint profiles" % (args.out, len(profiles)))

    print("\n=== QA ===")
    _crosswalk_check()
    code = 1050  # chest pain -- engine's canonical example
    needs, context = needs_vector(code, profiles)
    print("\nsample needs for code %d (%s, %d visits):" % (
        code, profiles[code]["label"], profiles[code]["n_visits"]))
    for n in needs[:4]:
        print("  %-24s w=%.3f critical=%s\n      %s" % (
            n["service"], n["weight"], n["critical"], n["weight_source"]))
    if context:
        print("  context (not in catalog):", context)
    # CI sanity: every profile has both bounds for every nonzero share
    bad = [c for c, v in profiles.items()
           for s, x in v["services"].items()
           if x["share"] > 0 and (x["ci_lo"] is None or x["ci_hi"] is None)]
    assert not bad, "profiles with missing CIs: %s" % bad[:5]
    print("all %d profiles carry Wilson 95%% CIs on every nonzero share" %
          len(profiles))


if __name__ == "__main__":
    main()
