"""Generate ui/files/config/service_registry.json from the platinum tables.

Reads labuser_jdw2.platinum.service_catalog + corroboration_rules and emits one
registry entry per catalog service: key, plain-language display name (curated
override or camelCase-split draft), type, parent specialty, critical flag, minimum
facility class / doctors, and the required/supporting corroboration item keys.

The registry is the app-side vocabulary: the per-facility service maps returned by
config/queries/candidates.sql use the same `key` strings, and required/supporting
join against those maps so the UI can show "claimed but missing backing" warnings.

Run inside the workspace (SparkSession available), e.g. from a notebook:
    import runpy
    mod = runpy.run_path("/Workspace/Users/jdw2@andrew.cmu.edu/cmu_datathon26/ui/files/scripts/export_registry.py")
    mod["main"]([])
Optional argument: output path (default: ../config/service_registry.json next to
this script).

All 192 display names are DRAFT pending clinician review; nameSource records which
names are curated vs auto-drafted. Extend CURATED below (and re-run) to improve
names — never hand-edit the generated JSON.
"""

import json
import os
import re

CATALOG = "labuser_jdw2.platinum.service_catalog"
RULES = "labuser_jdw2.platinum.corroboration_rules"

# Acronym fixes applied after the camelCase split (part -> replacement).
ACRONYMS = {
    "Icu": "ICU", "Nicu": "NICU", "Cc": "CCU", "Ics": "CCU", "Cab": "CABG",
    "Cbg": "CABG", "Ivf": "IVF", "Iui": "IUI", "Icsi": "ICSI", "Ecg": "ECG",
    "Eeg": "EEG", "Ct": "CT", "Mr": "MRI", "Mri": "MRI", "Pet": "PET",
    "Lasik": "LASIK", "Hiv": "HIV", "Tavi": "TAVI", "Tavr": "TAVR",
    "IvfLab": "IVF", "IvfAnd": "IVF",
}

# Curated plain-language display names (service key -> name). Everything not
# listed here gets the auto-drafted camelCase split and nameSource "draft".
CURATED = {
    "cardiology": "Heart specialist (cardiology)", "ecgMachine": "Heart tests (ECG machine)",
    "echocardiography": "Heart scan (echocardiography)",
    "cathLab": "Cath lab", "angioplasty": "Angioplasty and stents", "cabgSurgery": "Bypass surgery (CABG)",
    "cardiacSurgery": "Heart and valve surgery",
    "cardiothoracicSurgery": "Cardiothoracic surgery", "interventionalCardiology": "Interventional cardiology",
    "pacemakerImplantation": "Pacemaker implantation",
    "icu": "Intensive care unit (ICU)", "nicu": "Neonatal intensive care unit (NICU)", "ventilator": "Ventilator",
    "pediatricCardiology": "Children's heart care",
    "emergencyCare": "Emergency care", "emergencyMedicine": "Emergency medicine",
    "ambulanceService": "Ambulance service", "open24x7": "Open 24x7",
    "dialysis": "Dialysis", "kidneyTransplant": "Kidney transplant", "liverTransplant": "Liver transplant",
    "transplantSurgery": "Transplant surgery",
    "jointReplacementSurgery": "Joint replacement surgery", "spineSurgery": "Spine surgery",
    "radiotherapy": "Radiotherapy", "chemotherapy": "Chemotherapy",
    "mriScanner": "MRI scanner", "ctScanner": "CT scanner", "petCtScanner": "PET-CT scanner",
    "xrayImaging": "X-ray imaging", "ultrasoundImaging": "Ultrasound imaging",
    "mammography": "Mammography", "pathologyLaboratory": "Pathology laboratory", "bloodBank": "Blood bank",
    "operationTheatre": "Operation theatre",
    "dentistry": "Dentistry", "rootCanalTreatment": "Root canal treatment", "toothExtraction": "Tooth extraction",
    "gumTreatment": "Gum treatment", "dentalImplants": "Dental implants", "dentalFillings": "Dental fillings",
    "teethCleaning": "Teeth cleaning", "teethWhitening": "Teeth whitening",
    "orthodonticBraces": "Braces (orthodontics)", "cataractSurgery": "Cataract surgery", "lasikSurgery": "LASIK surgery",
    "retinalCare": "Retinal care", "glaucomaTreatment": "Glaucoma treatment", "squintSurgery": "Squint surgery",
    "ophthalmology": "Eye care (ophthalmology)",
    "gynecologyAndObstetrics": "Gynaecology and obstetrics", "pediatrics": "Child care (pediatrics)",
    "neurology": "Neurology", "neurosurgery": "Neurosurgery",
    "nephrology": "Nephrology (kidney care)", "urology": "Urology", "ivf": "IVF (fertility)",
    "iui": "IUI (fertility)", "icsi": "ICSI (fertility)",
    "reproductiveEndocrinologyAndInfertility": "Fertility medicine (REI)",
    "physiotherapyRehab": "Physiotherapy and rehabilitation",
    "physicalMedicineAndRehabilitation": "Physical medicine and rehabilitation", "medicalOncology": "Medical oncology",
    "oncology": "Oncology", "radiology": "Radiology", "generalSurgery": "General surgery",
    "laparoscopicSurgery": "Laparoscopic (keyhole) surgery",
    "appendectomy": "Appendectomy", "herniaRepair": "Hernia repair", "gallbladderSurgery": "Gallbladder surgery",
    "hysterectomy": "Hysterectomy",
    "vaccination": "Vaccination", "healthCheckupPackages": "Health check-up packages",
    "outpatientServices": "Outpatient services", "inpatientServices": "Inpatient services",
    "telemedicine": "Telemedicine", "pharmacy": "Pharmacy", "homeVisitService": "Home visits",
    "onlineAppointmentBooking": "Online appointment booking",
    "wheelchairAccessibility": "Wheelchair accessible", "nabhAccredited": "NABH accredited",
    "isoCertified": "ISO certified",
    "cashlessInsurance": "Cashless insurance", "ayushmanBharatEmpanelled": "Ayushman Bharat empanelled",
    "internalMedicine": "Internal medicine",
    "familyMedicine": "Family medicine", "dermatology": "Dermatology (skin)", "psychiatry": "Psychiatry",
    "clinicalPsychology": "Clinical psychology",
    "plasticSurgery": "Plastic surgery", "cosmeticDentistry": "Cosmetic dentistry", "endodontics": "Endodontics",
    "periodontics": "Periodontics",
    "prosthodontics": "Prosthodontics", "orthopedicSurgery": "Orthopaedic surgery",
    "fractureCare": "Fracture care", "arthroscopy": "Arthroscopy",
    "colonoscopy": "Colonoscopy", "endoscopy": "Endoscopy", "gastroenterology": "Gastroenterology",
    "hepatology": "Hepatology (liver care)",
    "endocrinologyAndDiabetesAndMetabolism": "Endocrinology and diabetes", "thyroidSurgery": "Thyroid surgery",
    "bariatricSurgery": "Bariatric (weight-loss) surgery",
    # Fixes for auto-draft names that read badly
    "eegMachine": "EEG machine", "dexaScanner": "DEXA scanner", "uroCystoscopy": "Cystoscopy (urology)",
    "neuroOncology": "Neuro-oncology", "neuroOphthalmology": "Neuro-ophthalmology",
}


def humanize(key):
    parts = re.findall(r"[A-Z]?[a-z0-9]+|[A-Z]+(?![a-z])", key)
    parts = [ACRONYMS.get(p, p) for p in parts]
    out = " ".join(parts)
    out = out.replace(" And ", " and ").replace(" Of ", " of ")
    return out[0].upper() + out[1:]


def fetch_rows(spark):
    return spark.sql(
        f"""
        SELECT c.service_name, c.service_type, c.parent_specialty,
               r.critical, r.min_facility_class, r.min_doctors,
               r.required_services, r.supporting_services
        FROM {CATALOG} c
        LEFT JOIN {RULES} r ON r.service = c.service_name
        ORDER BY c.service_type, c.service_name
        """
    ).toPandas()


def build_registry(rows, generated):
    entries = []
    for _, r in rows.iterrows():
        key = r.service_name
        name = CURATED.get(key)
        entries.append(
            {
                "key": key,
                "name": name if name else humanize(key),
                "nameSource": "curated" if name else "draft",
                "type": r.service_type,
                "parent": r.parent_specialty if r.parent_specialty else key,
                "critical": bool(r.critical) if r.critical is not None else False,
                "minFacilityClass": r.min_facility_class,
                "minDoctors": int(r.min_doctors) if r.min_doctors is not None and r.min_doctors == r.min_doctors else None,
                "required": sorted(r.required_services) if r.required_services is not None else [],
                "supporting": sorted(r.supporting_services) if r.supporting_services is not None else [],
            }
        )
    return {
        "status": "DRAFT: needs clinician review",
        "note": "Generated from labuser_jdw2.platinum.service_catalog + corroboration_rules by scripts/export_registry.py. "
        "nameSource=draft names are auto-generated from the service key (camelCase split); review before wide release. "
        "required/supporting are catalog service keys that join against the per-facility service map.",
        "generated": generated,
        "services": entries,
    }


def check(registry):
    """Acceptance checks; raises AssertionError on any failure."""
    entries = registry["services"]
    assert len(entries) == 192, f"expected 192 services, got {len(entries)}"
    keys = [e["key"] for e in entries]
    assert len(set(keys)) == 192, "duplicate service keys"
    names = [e["name"] for e in entries]
    assert len(set(names)) == 192, f"duplicate display names: {[n for n in names if names.count(n) > 1]}"
    keyset = set(keys)
    bad_refs = sorted({s for e in entries for s in (e["required"] + e["supporting"]) if s not in keyset})
    assert not bad_refs, f"rule references not in catalog: {bad_refs}"
    bad_names = [e["name"] for e in entries if "  " in e["name"] or e["name"] != e["name"].strip()]
    assert not bad_names, f"malformed display names: {bad_names}"


def main(argv):
    here = os.path.dirname(os.path.abspath(__file__))
    out_path = argv[0] if argv else os.path.join(here, "..", "config", "service_registry.json")
    out_path = os.path.abspath(out_path)

    import datetime

    from pyspark.sql import SparkSession

    spark = SparkSession.builder.getOrCreate()
    rows = fetch_rows(spark)
    registry = build_registry(rows, datetime.date.today().isoformat())
    check(registry)

    text = json.dumps(registry, ensure_ascii=False, indent=2)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(text)
    n_curated = sum(1 for e in registry["services"] if e["nameSource"] == "curated")
    n_crit = sum(1 for e in registry["services"] if e["critical"])
    print(
        f"service_registry.json: 192 services "
        f"({n_curated} curated / {192 - n_curated} draft names), {n_crit} critical, "
        f"{len(text.encode())} bytes -> {out_path}"
    )


if __name__ == "__main__":
    import sys

    main(sys.argv[1:])
