"""catalog.py -- TODO 4: canonical service catalog + channel token mapping.

Builds on top of the gold table (labuser_jdw2.gold.facility_district_health_indicators)
and the Phase-0 platinum tables from features.py:

    platinum.service_catalog        one row per canonical service (specialties
                                    reused from features.py + procedures,
                                    equipment, capabilities, attributes).
    platinum.channel_token_map       one row per distinct normalized token per
                                    channel (procedure / equipment / capability)
                                    with n_facilities, mapped service (or NULL),
                                    map_method and confidence.
    platinum.channel_token_map_llm   persistent LLM cache -- ai_classify runs
                                    ONCE per (channel, token); re-runs only
                                    classify tokens not already cached.

Measured design basis (2026-11-22 profiling, facility-grain dedupe):
    procedure : 153,433 volume / 81,584 distinct tokens; 45% of volume is
                singletons. 90% of volume would need 66,241 tokens mapped.
    equipment :  52,159 volume / 33,487 distinct; 58% singletons.
    capability: 221,809 volume / 162,424 distinct; 68% singletons.
  => The plan's original ">=90% of token volume mapped" acceptance is
     unreachable by ANY token-level mapping (the tail is mostly one-off
     scrape sentences: history, contacts, staffing counts). The meaningful
     bars, reported by the QA section, are:
       (a) % of repeated-token (n>=2) volume with an explicit decision
           (mapped service OR explicitly not-a-service);
       (b) % of token-bearing facilities with >=1 mapped service;
       (c) a 30-row random sample of mappings printed for manual review.

Mapping layers, first-match-wins on normalized token text (lowercase,
alphanumerics + single spaces):
    1. rule        -- ordered regex catalog (curated from the top-token
                     frequency lists; verified against top 90 per channel).
    2. not_service -- ordered regex facts/amenities (established dates,
                     staffing/bed counts, facility-type statements, ...).
    3. llm        -- ai_classify (v2.1, confidence scores) over unmapped
                     tokens with n_facilities >= --llm-min, labels = the
                     full catalog + 'not_a_service', cached forever.
    4. unmapped   -- remaining tail (mostly singletons), kept for evidence
                     joins to skip.

Run:
    import runpy
    mod = runpy.run_path("src/catalog.py")
    mod["main"](["--no-llm"])        # rule layer only + coverage stats
    mod["main"]([])                   # full run incl. cached LLM pass
"""

import argparse
import json
import os
import sys
from functools import reduce

from pyspark.sql import DataFrame, SparkSession
from pyspark.sql import functions as F
from pyspark.sql.types import ArrayType, StringType

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from features import CANONICAL_SPECIALTIES  # noqa: E402

DEFAULT_TARGET_CATALOG = "labuser_jdw2"
CHANNELS = ["procedure", "equipment", "capability"]

# ---------------------------------------------------------------------------
# canonical service catalog: concrete services beyond the 101 specialties
# (name, type in {procedure, equipment, capability, attribute}, parent_specialty)
# ---------------------------------------------------------------------------
SERVICE_CATALOG = [
    # imaging / diagnostic equipment
    ("petCtScanner", "equipment", "radiology"),
    ("dexaScanner", "equipment", "radiology"),
    ("mammography", "equipment", "radiology"),
    ("ctScanner", "equipment", "radiology"),
    ("mriScanner", "equipment", "radiology"),
    ("xrayImaging", "equipment", "radiology"),
    ("ultrasoundImaging", "equipment", "radiology"),
    ("ecgMachine", "equipment", "cardiology"),
    ("eegMachine", "equipment", "neurology"),
    ("echocardiography", "equipment", "cardiology"),
    ("cathLab", "equipment", "interventionalCardiology"),
    ("pulmonaryFunctionTesting", "equipment", "pulmonology"),
    ("ophthalmicEquipment", "equipment", "ophthalmology"),
    ("pathologyLaboratory", "equipment", "pathology"),
    ("diagnosticServices", "capability", "radiology"),
    # dental procedures / equipment
    ("dentalChair", "equipment", "dentistry"),
    ("laserDentistry", "procedure", "dentistry"),
    ("dentalEquipment", "equipment", "dentistry"),
    ("dentalImplants", "procedure", "dentistry"),
    ("rootCanalTreatment", "procedure", "dentistry"),
    ("teethWhitening", "procedure", "dentistry"),
    ("toothExtraction", "procedure", "dentistry"),
    ("dentalFillings", "procedure", "dentistry"),
    ("teethCleaning", "procedure", "dentistry"),
    ("dentures", "procedure", "dentistry"),
    ("crownsAndBridges", "procedure", "dentistry"),
    ("veneers", "procedure", "dentistry"),
    ("smileDesigning", "procedure", "dentistry"),
    ("orthodonticBraces", "procedure", "orthodontics"),
    ("fullMouthRehabilitation", "procedure", "dentistry"),
    ("gumTreatment", "procedure", "periodontics"),
    # ophthalmology procedures (before ophthalmology specialty contains)
    ("cataractSurgery", "procedure", "cataractAndAnteriorSegmentSurgery"),
    ("lasikSurgery", "procedure", "refractiveSurgeryOphthalmology"),
    ("squintSurgery", "procedure", "pediatricOphthalmology"),
    ("glaucomaTreatment", "procedure", "glaucomaOphthalmology"),
    ("retinalCare", "procedure", "retinaAndVitreoretinalOphthalmology"),
    # orthopedics
    ("jointReplacementSurgery", "procedure", "orthopedicSurgery"),
    ("arthroscopy", "procedure", "orthopedicSurgery"),
    ("spineSurgery", "procedure", "orthopedicSpineSurgery"),
    ("fractureCare", "procedure", "orthopedicSurgery"),
    # general / specialty surgery
    ("minimallyInvasiveUrology", "procedure", "urology"),
    ("gallbladderSurgery", "procedure", "generalSurgery"),
    ("herniaRepair", "procedure", "generalSurgery"),
    ("hysterectomy", "procedure", "gynecologyAndObstetrics"),
    ("uroCystoscopy", "procedure", "urology"),
    ("cystRemoval", "procedure", "generalSurgery"),
    ("appendectomy", "procedure", "generalSurgery"),
    ("thyroidSurgery", "procedure", "generalSurgery"),
    ("woundCare", "procedure", "generalSurgery"),
    ("tumorRemoval", "procedure", "surgicalOncology"),
    ("fistulaTreatment", "procedure", "colorectalSurgery"),
    ("laparoscopicSurgery", "procedure", "generalSurgery"),
    ("kidneyTransplant", "procedure", "transplantSurgery"),
    ("liverTransplant", "procedure", "transplantSurgery"),
    ("plasticSurgeryProcedures", "procedure", "plasticSurgery"),
    # fertility
    ("icsi", "procedure", "reproductiveEndocrinologyAndInfertility"),
    ("iui", "procedure", "reproductiveEndocrinologyAndInfertility"),
    ("ivf", "procedure", "reproductiveEndocrinologyAndInfertility"),
    # cardiology procedures
    ("pacemakerImplantation", "procedure", "cardiology"),
    ("angioplasty", "procedure", "interventionalCardiology"),
    ("cabgSurgery", "procedure", "cardiacSurgery"),
    # urology / GI procedures
    ("lithotripsy", "procedure", "urology"),
    ("circumcision", "procedure", "urology"),
    ("colonoscopy", "procedure", "gastroenterology"),
    ("endoscopy", "procedure", "gastroenterology"),
    # major therapies
    ("dialysis", "procedure", "nephrology"),
    ("chemotherapy", "procedure", "medicalOncology"),
    ("radiotherapy", "procedure", "radiationOncology"),
    ("vaccination", "procedure", "preventiveMedicine"),
    ("bloodTransfusion", "procedure", "hematology"),
    ("bloodBank", "capability", "pathology"),
    ("healthCheckupPackages", "capability", "preventiveMedicine"),
    # facility-level care units / services
    ("nicu", "equipment", "neonatologyPerinatalMedicine"),
    ("icu", "equipment", "criticalCareMedicine"),
    ("operationTheatre", "equipment", None),
    ("ventilator", "equipment", "criticalCareMedicine"),
    ("ambulanceService", "capability", "emergencyMedicine"),
    ("pharmacy", "capability", None),
    ("emergencyCare", "capability", "emergencyMedicine"),
    ("telemedicine", "capability", None),
    ("onlineAppointmentBooking", "capability", None),
    ("homeVisitService", "capability", None),
    ("wheelchairAccessibility", "capability", None),
    ("open24x7", "capability", None),
    ("inpatientServices", "capability", None),
    ("outpatientServices", "capability", None),
    # attributes (ranking / context signals, not user services)
    ("nabhAccredited", "attribute", None),
    ("isoCertified", "attribute", None),
    ("ayushmanBharatEmpanelled", "attribute", None),
    ("cashlessInsurance", "attribute", None),
    # traditional medicine (real demand, kept out of specialty list)
    ("alternativeMedicine", "capability", None),
]

# ---------------------------------------------------------------------------
# ordered mapping rules: first match wins (regex over normalized token)
# order matters: specific multi-word patterns before generic stems;
# procedures/equipment before specialty contains; NOT_SERVICE last.
# ---------------------------------------------------------------------------
RULES = [
    # --- imaging & diagnostic equipment (specific -> generic) ---
    ("petct|pet ?ct|pet scan", "petCtScanner"),
    ("dexa", "dexaScanner"),
    ("mammograph", "mammography"),
    (r"\bct\b|ct ?scan|slice ct", "ctScanner"),
    (r"\bmri\b", "mriScanner"),
    ("x ?ray|xray|radiograph", "xrayImaging"),
    ("ultrasound|sonograph|\\busg\\b", "ultrasoundImaging"),
    (r"\becg\b|electrocardiog", "ecgMachine"),
    (r"\beeg\b|electroencephalog", "eegMachine"),
    ("echocardiograph|\\becho\\b", "echocardiography"),
    ("cath ?lab", "cathLab"),
    # --- fertility (before lab rules so 'ivf laboratories' -> ivf) ---
    (r"\bicsi\b|intracytoplasmic", "icsi"),
    (r"\biui\b|intrauterine insemination|\binsemination\b", "iui"),
    (r"\bivf\b|in ?vitro fertilization|fertility treatment|ivf program", "ivf"),
    ("pulmonary function|spirometry|\\bpft\\b", "pulmonaryFunctionTesting"),
    ("ophthalmic|slit lamp|fundus|autorefracto|tonometer|optical coherence|"
     "keratometer|visual field|\\bphaco\\b", "ophthalmicEquipment"),
    ("patholog|laborator|\\blabs?\\b|blood test|sample collection",
     "pathologyLaboratory"),
    ("diagnos", "diagnosticServices"),
    # --- dental equipment & procedures ---
    ("dental chair|dental unit|dental operatory", "dentalChair"),
    ("laser dentistry|dental laser", "laserDentistry"),
    ("dental light|dental equipment|intraoral|dental microscope|"
     "dental instrument|dental tool|overhead dental", "dentalEquipment"),
    ("dental implant|implant fixing|teeth implant|implant dentistry|"
     "dental implantation|implant placement|implantolog", "dentalImplants"),
    ("root canal|\\brct\\b", "rootCanalTreatment"),
    ("whitening|bleaching", "teethWhitening"),
    ("wisdom tooth|tooth extraction|teeth extraction|surgical extraction|"
     "extraction of", "toothExtraction"),
    ("dental filling|tooth filling|\\bfillings?\\b", "dentalFillings"),
    ("teeth cleaning|dental cleaning|scaling|polishing", "teethCleaning"),
    ("denture", "dentures"),
    ("crown|\\bbridge", "crownsAndBridges"),
    ("veneer", "veneers"),
    ("smile", "smileDesigning"),
    ("braces|orthodontic|aligner|invisalign", "orthodonticBraces"),
    ("full mouth|mouth rehab|mouth reconstruction", "fullMouthRehabilitation"),
    # (curated 2026-11-22: 'de pigmentation of gums' -- before the dermatology
    # pigmentation rule below steals it)
    (r"\bgum\b|gum treatment|periodont|de ?pigmentation", "gumTreatment"),
    # --- ophthalmology procedures ---
    ("cataract", "cataractSurgery"),
    ("lasik|refractive surgery", "lasikSurgery"),
    # corneal transplants (curated 2026-11-22: 'pdek' was missed by every
    # layer at conf 0.2)
    ("keratoplast|\\bpdek\\b|\\bdsek\\b|\\bdsaek\\b", "corneaOphthalmology"),
    ("squint|strabismus", "squintSurgery"),
    ("glaucoma", "glaucomaTreatment"),
    ("retin|vitreoretinal|macular", "retinalCare"),
    # --- orthopedics ---
    ("knee replacement|hip replacement|shoulder replacement|joint replacement|"
     "joint reconstruction|ac ?joint|arthroplast|replacement surgery",
     "jointReplacementSurgery"),
    # robotic-assisted joint surgery (curated 2026-11-22: LLM had mapped
    # 'velys robotic system' to laparoscopicSurgery -- Velys assists knee
    # replacement)
    ("\\bvelys\\b|\\bmako\\b|robotic (knee|hip|joint)", "jointReplacementSurgery"),
    # knee ligament / sports reconstruction (curated 2026-11-22: LLM had put
    # 'acl pcl repair' and 'mpfl reconstruction' in orthopedicSpineSurgery)
    ("anterior cruciate|posterior cruciate|\\bacl\\b|\\bpcl\\b|\\bmpfl\\b|"
     "ligament reconstruct|ligament repair", "arthroscopy"),
    ("arthroscop", "arthroscopy"),
    ("spine surg|spinal surg|scoliosis|slip disc|disc surgery|back surgery|"
     "spine treatment", "spineSurgery"),
    (r"fracture|\btrauma\b|polytrauma", "fractureCare"),
    # --- surgery (specific before generic laparoscopic) ---
    ("minimally invasive urology|endourolog", "minimallyInvasiveUrology"),
    ("cholecystectomy|gall ?bladder", "gallbladderSurgery"),
    ("hernia", "herniaRepair"),
    ("hysterectomy|myomectomy|fibroid", "hysterectomy"),
    ("cystoscop", "uroCystoscopy"),
    ("cyst removal|cyst excision|\\bcyst\\b", "cystRemoval"),
    ("append", "appendectomy"),
    ("thyroid", "thyroidSurgery"),
    ("wound", "woundCare"),
    ("tumor|tumour|cancer surgery|oncologic surger", "tumorRemoval"),
    ("fistula|piles|haemorrhoid|hemorrhoid|proctolog", "fistulaTreatment"),
    ("laparoscop|minimal access|minimally invasive surg", "laparoscopicSurgery"),
    ("kidney transplant|renal transplant", "kidneyTransplant"),
    ("liver transplant", "liverTransplant"),
    # dermatology skin/cosmetic procedures (curated 2026-11-22: LLM had put
    # 'q switched nd yag laser system' in laserDentistry -- Q-switched lasers
    # are tattoo/pigmentation removal)
    ("q ?switched|tattoo|pigmentation|hair removal|hydrafacial|mesotherap|"
     "tricholog", "dermatology"),
    ("plastic surgery|cosmetic surgery|reconstructive|rhinoplasty|liposuction|"
     "hair transplant|botox|\\bfillers?\\b|aesthetic surgery|gynecomastia|"
     "abdominoplasty|tummy|body contouring|anti ?aging", "plasticSurgeryProcedures"),
    # --- cardiology procedures ---
    ("pacemaker", "pacemakerImplantation"),
    ("angioplasty|angiograph|\\bstent\\b|\\bptca\\b", "angioplasty"),
    ("cabg|bypass|open ?heart", "cabgSurgery"),
    # --- urology / GI ---
    ("lithotrips|erswl|kidney stone|stone removal|renal stone|\\bstone\\b",
     "lithotripsy"),
    ("circumcision", "circumcision"),
    ("colonoscop", "colonoscopy"),
    ("endoscop", "endoscopy"),
    # --- major therapies / services ---
    ("dialysis|hemodialysis|haemodialysis", "dialysis"),
    ("chemotherap|\\bchemo\\b", "chemotherapy"),
    ("radiotherap|radiation therap|linear accelerator|\\blinac\\b|brachytherapy",
     "radiotherapy"),
    ("vaccin|immuniz", "vaccination"),
    ("transfusion|blood donation", "bloodTransfusion"),
    ("blood bank", "bloodBank"),
    ("health check|check ?up|master health|health package|preventive health|"
     "full body", "healthCheckupPackages"),
    # --- care units / facility services ---
    (r"\bnicu\b|neonatal intensive", "nicu"),
    (r"\bicu\b|intensive care unit|critical care", "icu"),
    ("operation theat|operating theat|\\bots\\b|modular ot", "operationTheatre"),
    ("ventilator", "ventilator"),
    ("ambulance", "ambulanceService"),
    ("pharmac|medical store|chemist|medical shop|drug store", "pharmacy"),
    ("emergency", "emergencyCare"),  # before open24x7: '24x7 emergency' -> emergencyCare
    ("teleconsult|telemedicine|tele ?medicine|video consult|online consultation",
     "telemedicine"),
    ("online appointment|appointment booking|online booking|book .?online",
     "onlineAppointmentBooking"),
    ("home visit|home care|door ?step|domiciliary|nursing at home", "homeVisitService"),
    ("wheel ?chair|handicapped|disability access|barrier free",
     "wheelchairAccessibility"),
    ("24 ?x ?7|\\b247\\b|24 ?7\\b|24 ?hrs|24 ?hours|round the clock|always open|"
     "24 hours a day|24hr", "open24x7"),
    ("inpatient|\\bipd\\b", "inpatientServices"),
    ("outpatient|\\bopd\\b", "outpatientServices"),
    # --- accreditation / attributes ---
    (r"nabh|\bjci\b", "nabhAccredited"),
    (r"iso ?9\d*|iso certified", "isoCertified"),
    ("ayushman|pmjay|cghs|empanelled", "ayushmanBharatEmpanelled"),
    ("insurance|cashless|\\btpa\\b", "cashlessInsurance"),
    # --- specialty contains (specific before general) ---
    ("interventional radiolog", "interventionalRadiology"),
    ("maxillofacial|oral surg", "oralAndMaxillofacialSurgery"),
    ("pediatric dentistr|paediatric dentistr|pedodont", "pediatricDentistry"),
    ("dentistr|\\bdental\\b|dentist|teeth|oral health", "dentistry"),
    ("gynecolog|obstetric|maternity|pregnanc|womens health", "gynecologyAndObstetrics"),
    ("ophthalmolog|optometr|eye care|eye hospital|eye clinic|eye specialist|"
     r"\beyes?\b", "ophthalmology"),
    ("cardiolog", "cardiology"),
    ("nephrolog|kidney disease|kidney care", "nephrology"),
    (r"\burolog", "urology"),
    ("neurosurg", "neurosurgery"),
    ("neurolog", "neurology"),
    ("dermatolog|\\bskin\\b|cosmetolog", "dermatology"),
    ("orthopa?ed|musculoskeletal|\\bbone\\b|joint pain|sports injury",
     "orthopedicSurgery"),
    ("otolaryngolog|ear nose|nose and throat|\\bent\\b", "otolaryngology"),
    ("pediatric|paediatric|child", "pediatrics"),
    ("bariatric|weight loss|obesity", "bariatricSurgery"),
    ("transplant", "transplantSurgery"),
    ("internal medicine|general medicine", "internalMedicine"),
    ("general surg", "generalSurgery"),
    ("psychiatr|mental health", "psychiatry"),
    ("psycholog", "clinicalPsychology"),
    ("radiolog", "radiology"),
    ("pulmonolog|respiratory|chest disease|asthma|tuberculosis|\\btb\\b",
     "pulmonology"),
    ("gastroenterolog|\\bgastro\\b|liver disease|hepat", "gastroenterology"),
    ("endocrinolog|diabetes|thyroid disease|hormone",
     "endocrinologyAndDiabetesAndMetabolism"),
    ("oncolo|cancer", "oncology"),
    ("hematolog|haematolog|blood disorder|blood disease", "hematology"),
    ("rheumatolog|arthritis", "rheumatology"),
    # (curated 2026-11-22: 'specialized pain clinic' had gone to anesthesia)
    ("physiotherap|physio|rehabilitat|\\bpmr\\b|sports medicine|pain management|"
     "pain clinic|chiropract", "physicalMedicineAndRehabilitation"),
    # anesthesia machines (curated 2026-11-22: 'boyle s apparatus' had gone
    # to pulmonaryFunctionTesting)
    ("boyle ?s? apparatus", "anesthesia"),
    ("anesthes|anaesthes", "anesthesia"),
    ("allerg|immunolog", "allergyAndImmunology"),
    ("infectious|\\bhiv\\b|\\baids\\b", "infectiousDiseases"),
    ("geriatric|elderly", "geriatrics"),
    ("dietitian|nutrition|diet", "nutritionAndDietetics"),
    ("podiatr|foot care", "podiatry"),
    ("ayurved|homeopath|unani|siddha|naturopath", "alternativeMedicine"),
]

# ordered facts / amenities that are explicitly NOT services (after all
# service rules so e.g. 'board certified in cardiology' still maps).
NOT_SERVICE_PATTERNS = [
    r"established|founded|since \d|began|incorporated|started in|opened its",
    r"has \d",
    ("doctors on staff|doctors available|\\bdoctors\\b|\\bemployees\\b|staff of|"
     "\\bbeds\\b|\\bbed\\b \\d|number of beds"),
    r"years in|years of|experience",
    ("located|situated|address|pincode|pin code|\\bnear\\b|district of|"
     "in ahmedabad"),
    ("multispecial|multi special|super special|specialty hospital|"
     "speciality hospital"),
    ("privat|public company|non ?profit|charitable|\\btrust\\b|society|"
     "government|owned by"),
    ("operates as|is a|recognized|approved|registered|licensed|affiliated|"
     "certified"),
    ("recency|updated|social media|followers|likes|facebook|instagram|"
     "twitter|website|webpage|\\bpage\\b"),
    r"accepts|volunteer",
    r"award|rank|rated|review|star rated",
    ("bathroom|toilet|washroom|drinking water|waiting area|seating|"
     "air condition|\\blift\\b|elevator|canteen|cafeteria|parking|stethoscope|"
     "\\bgloves\\b|syringe"),
    ("open days|working hours|timings|closed on|sunday|monday|weekday"),
    r"payment|\bupi\b|paytm|cash only|\bcard\b",
    r"branch|franchise",
    r"\bnumber\b|count of",
    # --- curation pass 2026-11-22: vague claims the --llm-min 2 batch had
    # force-mapped to concrete services at low confidence (conf < 0.5) ---
    r"state of the art|latest techniques|latest medical|modern equipment|modern technology",
    r"revision surger|advanced surgeries|micro surger",
    r"regenerative therap",
    r"comprehensive (care|consultation)",
    r"autoclav|sterilizer",
    r"suction apparatus|wall mounted suction",
    r"display monitor|wall mounted (display )?monitor",
    r"reports via email|same day reports",
    r"depicted in (facility )?imagery",
    r"laser (machine|therapy device)|laser surgery capabilit|laser treatment available",
    r"performed over",
]

ALL_CATALOG_NAMES = [s[0] for s in SERVICE_CATALOG] + list(CANONICAL_SPECIALTIES)


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def norm_token(col):
    """Space-preserving normalization: lowercase, non-alnum -> space, collapse."""
    return F.trim(
        F.regexp_replace(
            F.regexp_replace(F.lower(F.trim(col)), r"[^a-z0-9]+", " "),
            r"\s+", " "))


def write_table(spark, df, name):
    """Idempotent full-snapshot write; safe to re-run after any failure."""
    df.write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(name)
    print(f"wrote {name}: {spark.table(name).count():,} rows, {len(df.columns)} cols")


def facility_tokens(spark, gold_table):
    """Distinct (channel, unique_id, normalized token) across the 3 channels."""
    g = spark.table(gold_table)
    parts = []
    for ch in CHANNELS:
        t = (g.select("unique_id",
                      F.from_json(F.trim(F.col(ch).cast("string")),
                                  ArrayType(StringType())).alias("arr"))
             .where(F.col("arr").isNotNull())
             .select("unique_id", F.explode("arr").alias("raw"))
             .withColumn("token", norm_token(F.col("raw")))
             .where(F.length("token") > 0)
             .select("unique_id", "token")
             .distinct()
             .withColumn("channel", F.lit(ch)))
        parts.append(t)
    return reduce(DataFrame.unionAll, parts)


def token_stats(ft):
    """(channel, token) -> n_facilities."""
    return (ft.groupBy("channel", "token")
              .agg(F.count("*").alias("n_facilities")))


def apply_rules(stats):
    """Rule layer: service (first-match) + not_service flag."""
    service = None
    for pat, name in RULES:
        cond = F.col("token").rlike(pat)
        service = (F.when(cond, F.lit(name)) if service is None
                  else service.when(cond, F.lit(name)))
    not_service = None
    for pat in NOT_SERVICE_PATTERNS:
        cond = F.col("token").rlike(pat)
        not_service = (F.when(cond, F.lit(True)) if not_service is None
                       else not_service.when(cond, F.lit(True)))
    not_service = not_service.otherwise(F.lit(False))
    return stats.select(
        "channel", "token", "n_facilities",
        service.alias("service"),
        not_service.alias("_not_service"))


# ---------------------------------------------------------------------------
# LLM layer: ai_classify over unmapped tokens, cached forever
# ---------------------------------------------------------------------------
LLM_INSTRUCTIONS = (
    "Inputs are scraped text snippets describing attributes of Indian "
    "healthcare facilities (hospitals, clinics, labs, pharmacies). Each "
    "snippet is a procedure performed, equipment owned, or a capability or "
    "fact about the facility. Pick the single best-fit service label from "
    "the label list. If the snippet is a historical fact, contact info, "
    "staffing or bed counts, a location statement, a facility-type "
    "description, a payment or insurance note, or anything else that is "
    "not a healthcare service or medical attribute, pick not_a_service."
)


def llm_pass(spark, plat, unmapped, min_n):
    """Classify unmapped tokens with ai_classify; cache persists across runs.

    Returns the full cache DataFrame (channel, token, label, confidence).
    Only tokens missing from the cache are sent to the model, so the
    expensive pass runs once per (channel, token).
    """
    cache_tbl = f"{plat}.channel_token_map_llm"
    to_do = unmapped.where(F.col("n_facilities") >= min_n)
    if spark.catalog.tableExists(cache_tbl):
        cache = spark.table(cache_tbl)
        to_do = to_do.join(cache.select("channel", "token"),
                           ["channel", "token"], "left_anti")
    else:
        cache = None
    n_do = to_do.count()
    print(f"LLM pass: {n_do:,} new tokens to classify (n_facilities >= {min_n})")
    if n_do == 0:
        return cache

    labels_json = json.dumps(ALL_CATALOG_NAMES + ["not_a_service"])
    to_do.createOrReplaceTempView("catalog_llm_todo")
    classified = spark.sql(f"""
        WITH c AS (
          SELECT channel, token,
                 ai_classify(token, '{labels_json}',
                   MAP('version', '2.1',
                       'instructions', '{LLM_INSTRUCTIONS}',
                       'enableConfidenceScores', 'true')) AS r
          FROM catalog_llm_todo
        )
        SELECT channel, token,
               r:response[0].value::STRING        AS label,
               r:response[0].confidence_score::DOUBLE AS confidence
        FROM c
    """)
    classified = classified.withColumn(
        "label", F.when(F.col("label").isin(ALL_CATALOG_NAMES + ["not_a_service"]),
                        F.col("label")).otherwise(F.lit("llm_unknown")))
    result = (classified if cache is None
              else cache.select("channel", "token", "label", "confidence")
                      .unionByName(classified))
    write_table(spark, result, cache_tbl)
    return spark.table(cache_tbl)


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--no-llm", action="store_true", help="rule layer only")
    p.add_argument("--llm-min", type=int, default=3,
                   help="min n_facilities for LLM classification (default 3)")
    args = p.parse_args(argv)

    spark = SparkSession.builder.getOrCreate()
    gold = f"{DEFAULT_TARGET_CATALOG}.gold.facility_district_health_indicators"
    plat = f"{DEFAULT_TARGET_CATALOG}.platinum"

    # 1. service catalog ---------------------------------------------------
    concrete = [(n, "specialty", None) for n in CANONICAL_SPECIALTIES]
    cat = (spark.createDataFrame(
              [list(r) for r in concrete + SERVICE_CATALOG],
              "service_name string, service_type string, parent_specialty string")
           .distinct())
    write_table(spark, cat, f"{plat}.service_catalog")
    cat_names = [r[0] for r in cat.select("service_name").distinct().collect()]
    print(f"catalog: {len(cat_names)} services "
          f"({len(CANONICAL_SPECIALTIES)} specialties + "
          f"{len(SERVICE_CATALOG)} concrete services)")

    # 2. tokens + rules ----------------------------------------------------
    ft = facility_tokens(spark, gold)
    stats = token_stats(ft)
    mapped = (apply_rules(stats)
              .withColumn("map_method", F.lit(None).cast("string"))
              .withColumn("confidence", F.lit(None).cast("double")))

    # 3. LLM layer (cached) -----------------------------------------------
    unmapped = (mapped.where(F.col("service").isNull() & ~F.col("_not_service")))
    if not args.no_llm:
        cache = llm_pass(spark, plat, unmapped, args.llm_min)
        if cache is not None:
            mapped = (mapped.join(
                          cache.select("channel", "token", "label",
                                       F.col("confidence").alias("llm_conf")),
                          ["channel", "token"], "left")
                      .withColumn(
                          "_llm_svc",
                          # curation 2026-11-22: a cached LLM label must
                          # NEVER override a human-curated not_service
                          # pattern (e.g. 'laser machine' had kept a cached
                          # laserDentistry label despite being not-a-service)
                          F.when(F.col("label").isin(cat_names)
                                 & ~F.col("_not_service"),
                                 F.col("label")))
                      .withColumn(
                          "service",
                          F.coalesce(F.col("service"), F.col("_llm_svc")))
                      .withColumn(
                          "map_method",
                          F.when((F.col("label") == "not_a_service") &
                                 F.col("service").isNull(),
                                 F.lit("not_service_llm"))
                           .when(F.col("_llm_svc").isNotNull() &
                                 (F.col("service") == F.col("_llm_svc")),
                                 F.lit("llm"))
                           .otherwise(F.col("map_method")))
                      .withColumn(
                          "confidence",
                          F.coalesce(F.col("llm_conf"), F.col("confidence")))
                      .drop("_llm_svc", "llm_conf"))
    else:
        for thr in (2, 3, 5, 10):
            n = unmapped.where(F.col("n_facilities") >= thr).count()
            print(f"  unmapped tokens with n_facilities >= {thr}: {n:,}")

    # 4. final map ---------------------------------------------------------
    final = (mapped.withColumn(
        "map_method",
        F.when(F.col("map_method").isNotNull(), F.col("map_method"))
         .when(F.col("service").isNotNull(), F.lit("rule"))
         .when(F.col("_not_service"), F.lit("not_service_rule"))
         .otherwise(F.lit("unmapped")))
        .drop("_not_service")
        .select("channel", "token", "n_facilities", "service",
                "map_method", "confidence"))
    # attach service_type from the catalog
    cat_small = (spark.table(f"{plat}.service_catalog")
                 .select("service_name", "service_type")
                 .withColumnRenamed("service_type", "svc_type"))
    final = (final.join(cat_small, final.service == cat_small.service_name,
                        "left")
             .drop("service_name")
             .withColumnRenamed("svc_type", "service_type")
             .select("channel", "token", "n_facilities", "service",
                     "service_type", "map_method", "confidence"))
    write_table(spark, final, f"{plat}.channel_token_map")

    # 5. QA ----------------------------------------------------------------
    print("\n=== coverage by channel (token volume = facility-token pairs) ===")
    (final.groupBy("channel")
          .agg(F.sum("n_facilities").alias("volume"),
               F.sum(F.when(F.col("service").isNotNull(), F.col("n_facilities")))
                .alias("svc_vol"),
               F.sum(F.when(F.col("map_method").startswith("not_service"),
                            F.col("n_facilities"))).alias("ns_vol"),
               F.count("*").alias("n_tokens"))
          .withColumn("svc_pct", F.round(F.col("svc_vol") / F.col("volume") * 100, 1))
          .withColumn("dec_pct", F.round((F.col("svc_vol") + F.col("ns_vol"))
                                          / F.col("volume") * 100, 1))
          .select("channel", "volume", "n_tokens", "svc_pct", "dec_pct")
          .show(truncate=False))

    print("=== coverage of repeated tokens (n_facilities >= 2) ===")
    rep = final.where(F.col("n_facilities") >= 2)
    (rep.groupBy("channel")
        .agg(F.sum("n_facilities").alias("volume"),
             F.sum(F.when(F.col("service").isNotNull(), F.col("n_facilities")))
              .alias("svc_vol"),
             F.sum(F.when(F.col("map_method").startswith("not_service"),
                          F.col("n_facilities"))).alias("ns_vol"))
        .withColumn("svc_pct", F.round(F.col("svc_vol") / F.col("volume") * 100, 1))
        .withColumn("dec_pct", F.round((F.col("svc_vol") + F.col("ns_vol"))
                                        / F.col("volume") * 100, 1))
        .select("channel", "volume", "svc_pct", "dec_pct")
        .show(truncate=False))

    print("=== facility-grain coverage: facilities with >=1 mapped service ===")
    svc_map = final.where(F.col("service").isNotNull()).select("channel", "token")
    with_tok = ft.select("channel", "unique_id").distinct()
    with_svc = (ft.join(svc_map, ["channel", "token"])
                .select("channel", "unique_id").distinct())
    (with_tok.groupBy("channel").agg(F.count("*").alias("facs_with_tokens"))
     .join(with_svc.groupBy("channel").agg(F.count("*").alias("facs_with_service")),
           "channel")
     .withColumn("pct", F.round(F.col("facs_with_service")
                                 / F.col("facs_with_tokens") * 100, 1))
     .show(truncate=False))
    n_all_tok = ft.select("unique_id").distinct().count()
    n_all_svc = (ft.join(svc_map, ["channel", "token"])
                 .select("unique_id").distinct().count())
    print(f"overall: {n_all_svc}/{n_all_tok} token-bearing facilities "
          f"have >=1 mapped service "
          f"({round(n_all_svc / n_all_tok * 100, 1)}%)")

    # structural checks
    assert final.where(F.col("map_method").isNull()).count() == 0, \
        "every token must carry a map_method"
    bad = (final.where(F.col("service").isNotNull())
           .join(cat_small, final.service == cat_small.service_name, "left_anti")
           .count())
    assert bad == 0, f"{bad} mapped services missing from catalog"
    print("structural checks passed (map_method complete; services in catalog)")

    print("\n=== 30 random mappings for manual verification ===")
    (final.where(F.col("service").isNotNull())
     .orderBy(F.rand(7))
     .limit(30)
     .select("channel", "token", "service", "map_method",
             F.round(F.coalesce(F.col("confidence"), F.lit(1.0)), 2).alias("conf"))
     .show(30, truncate=55))


if __name__ == "__main__":
    main()
