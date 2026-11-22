"""Build the engine lookup tables from NHAMCS 2022. Run: python3 -I scripts/build_engine_tables.py
Ported from engine-src/ff.py ("Minimal app pipeline", part 1 and 2). Local, read-only; writes 3 JSON files."""
import json, math, os
import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "client/src/engine/data")
MIN_VISITS = 50
GROUP = {"emergency": "eval", "ecg": "eval", "xray": "eval", "ct": "eval", "mri": "eval", "ultrasound": "eval", "lab": "eval",
         "fracture_care": "eval", "inpatient": "care", "icu": "care", "operating_room": "care", "cath_lab": "care",
         "c_section": "care", "dialysis": "care"}
SERVICES = list(GROUP)
# how each service is read off one survey visit (c_section / dialysis have no survey column -> share 0)
VISIT_HAS = {
    "emergency": lambda d: d.IMMEDR.isin([1, 2, 3]),
    "ecg": lambda d: d.EKG == 1, "xray": lambda d: d.XRAY == 1, "ct": lambda d: d.CATSCAN == 1,
    "mri": lambda d: d.MRI == 1, "ultrasound": lambda d: d.ULTRASND == 1,
    "lab": lambda d: (d[["CBC", "CMP", "BMP", "CARDENZ", "URINE", "OTHERBLD"]] == 1).any(axis=1),
    "fracture_care": lambda d: d.CASTSPLINT == 1,
    "inpatient": lambda d: (d.ADMITHOS == 1) | (d.OBSHOS == 1),
    "icu": lambda d: d.ADMIT == 1, "operating_room": lambda d: d.ADMIT == 3, "cath_lab": lambda d: d.ADMIT == 5,
}

def wilson95(p, n):
    if n <= 0:
        return (0.0, 1.0)
    z = 1.959963985
    c = p + z * z / (2 * n); d = 1 + z * z / n
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return (max(0.0, (c - h) / d), min(1.0, (c + h) / d))

rd = pd.io.stata.StataReader(os.path.join(ROOT, "engine-src/ed2022-stata.dta"))
df = rd.read(convert_categoricals=False)
labels = rd.value_labels()["RFV3DF"]
df["PATWT"] = df["PATWT"].astype("float64")

complaints = []
for code, rs in df.groupby("RFV13D"):
    code = int(code)
    if len(rs) < MIN_VISITS or code < 0:
        continue
    shares, ci = {s: 0.0 for s in SERVICES}, {}
    for s, f in VISIT_HAS.items():
        pool = rs[rs.IMMEDR.isin([1, 2, 3, 4, 5])] if s == "emergency" else rs
        w = pool.PATWT
        W = w.sum() or 1
        shares[s] = float(w[f(pool)].sum() / W)
        n_eff = W * W / ((w ** 2).sum() or 1)          # Kish effective n
        ci[s] = wilson95(shares[s], n_eff)
    needs = [dict(service=s, group=GROUP[s], share=p, ci_lo=ci[s][0], ci_hi=ci[s][1])
             for s, p in sorted(shares.items(), key=lambda x: -x[1]) if p >= 0.1]
    complaints.append(dict(code=code, label=labels.get(code, "?"), n_visits=len(rs), needs=needs, shares=shares))

pathways = {  # complaint code -> rule (tags, focus, escalation service)
    "1050": dict(tags=["cardiology", "interventionalcardiology", "emergencymedicine"], focus=["heart"], escalation="cath_lab"),
    "1415": dict(tags=["pulmonology", "cardiology", "emergencymedicine"], focus=["heart", "chest"], escalation="icu"),
    "1930": dict(tags=["orthopedicsurgery", "emergencymedicine"], focus=["ortho"], escalation="operating_room"),
    "1790": dict(tags=["gynecologyandobstetrics"], focus=["maternity"], escalation="c_section"),
}
SAFE = "Call 112 (or 108 for an ambulance) NOW."
guidelines = {
    "stroke": dict(label="Stroke / suspected stroke (guideline pathway)",
                   kw=r"\bstroke|slurred speech|face droop|paralys|one[- ]sided (numb|weak)",
                   services={"ct": 0.3, "icu": 0.35, "ecg": 0.15, "lab": 0.2}, critical=True,
                   advice="Suspected stroke is time-critical. " + SAFE),
    "dialysis": dict(label="Dialysis / kidney failure (guideline pathway)", kw=r"dialys|kidney failure|renal fail",
                     services={"dialysis": 0.5, "lab": 0.3, "inpatient": 0.2}, critical=False,
                     advice="If dialysis has been missed for days or symptoms are severe, call 112 (or 108)."),
    "burns": dict(label="Burns (guideline pathway)", kw=r"\bburn|scald",
                  services={"emergency": 0.25, "icu": 0.3, "operating_room": 0.2, "lab": 0.25}, critical=True,
                  advice="Serious burns are time-critical. " + SAFE),
    "snakebite": dict(label="Snakebite (guideline pathway)", kw=r"snake ?bite|snakebite|venom",
                      services={"emergency": 0.4, "icu": 0.3, "lab": 0.3}, critical=True,
                      advice="Snakebite is time-critical. " + SAFE),
    "poisoning": dict(label="Poisoning / overdose (guideline pathway)", kw=r"poison|overdose|swallowed|suicide attempt",
                      services={"emergency": 0.4, "icu": 0.3, "lab": 0.3}, critical=True,
                      advice="Poisoning is time-critical. " + SAFE),
    "mental_health": dict(label="Mental-health crisis (guideline pathway)", kw=r"depress|hallucin|psychiat|mental health|suicid",
                          services={"emergency": 0.5, "inpatient": 0.5}, critical=True,
                          advice="If there is risk of self-harm, call 112 (or 108) or Tele-MANAS 14416 now."),
}
fallback = dict(label="Unrecognised problem (general-care fallback)", services={"emergency": 0.5, "inpatient": 0.5}, critical=False,
                advice="We could not map this description to a known complaint. If it feels urgent, call 112 (or 108).")

for name, obj in (("complaints", complaints), ("pathways", pathways), ("guidelines", dict(guidelines=guidelines, fallback=fallback))):
    with open(os.path.join(OUT, name + ".json"), "w") as fh:
        json.dump(obj, fh, separators=(",", ":"))
print("complaints:", len(complaints))

# Verify chest pain (1050) against the printed demo
printed = {"emergency": (96, 93, 98), "ecg": (86, 83, 90), "xray": (81, 78, 85), "lab": (78, 74, 82), "ct": (18, 15, 23), "inpatient": (18, 15, 22)}
cp = next(c for c in complaints if c["code"] == 1050)
print("chest pain n=%d" % cp["n_visits"])
for n in cp["needs"][:6]:
    pr = printed.get(n["service"])
    mine = (int(n["share"] * 100), round(n["ci_lo"] * 100), round(n["ci_hi"] * 100))  # printed demo truncates the share (%d), rounds the CI (%.0f)
    print("%-10s ours %s printed %s %s" % (n["service"], mine, pr, "OK" if mine == pr else "DIFF"))
