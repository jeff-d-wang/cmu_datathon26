"""features.py -- Phase 0 feature layer (TODOs 1-3 of RECOMMENDER_PLAN.md).

Builds `<target>.platinum.*` on top of `<target>.gold.facility_district_health_indicators`:

    TODO 1  facility_scale, scale_rescued_evidence -- defensive parse of
            numberDoctors / capacity (numeric -> number; JSON arrays rescued
            into an evidence table; junk -> NULL + method flag).
    TODO 2  facility_class -- rule cascade over name + capability text ONLY
            (facilityTypeId / organization_type are cross-contaminated and
            deliberately ignored).
    TODO 3  specialty_token_map, facility_specialty -- canonical mapping of
            the semi-controlled `specialties` vocabulary.

Verified inputs driving these rules (2026-11-22 profiling of all 10,077 gold rows):
    numberDoctors: 3,628 pure ints / 6,333 'null' / 113 blank / 2 JSON arrays
                   (ophthalmic equipment text) / 1 hash junk.
    capacity:       2,511 pure ints (presumed bed count) / 7,449 'null' /
                   114 blank / 2 JSON arrays (capability text) / 1 'kie'.
    specialties:   118,056 facility-token volume over 2,701 distinct tokens;
                   95% of volume is covered by the top 183 tokens, and the
                   long tail is dominated by 1,785 singletons (scrape junk).

Run as a Databricks Job "Python file" task (spark provided by the runtime),
or from an attached notebook REPL:
    import runpy; runpy.run_path("features.py")
Idempotent full-snapshot writes; safe to re-run after any failure.
"""

import argparse
import re

from pyspark.sql import SparkSession
from pyspark.sql import functions as F
from pyspark.sql.types import ArrayType, StringType

DEFAULT_TARGET_CATALOG = "labuser_jdw2"

# ---------------------------------------------------------------------------
# TODO 3: canonical specialty vocabulary
# ---------------------------------------------------------------------------
# Curated from the observed frequency list (ranks 1-220 cover >=95% of
# facility-token volume). camelCase canonical names; matching is done on a
# normalized key (lowercase, strip, drop non-alphanumerics) so casing/dash/
# spacing variants of a canonical token map to it without extra entries.
CANONICAL_SPECIALTIES = [
    "internalMedicine", "familyMedicine", "gynecologyAndObstetrics",
    "dentistry", "orthopedicSurgery", "pediatrics", "generalSurgery",
    "cardiology", "radiology", "ophthalmology", "otolaryngology",
    "urology", "gastroenterology", "dermatology", "pathology",
    "nephrology", "emergencyMedicine", "neurology",
    "reproductiveEndocrinologyAndInfertility",
    "endocrinologyAndDiabetesAndMetabolism", "endodontics", "neurosurgery",
    "orthodontics", "oralAndMaxillofacialSurgery", "criticalCareMedicine",
    "physicalMedicineAndRehabilitation", "pulmonology", "plasticSurgery",
    "medicalOncology", "prosthodontics", "anesthesia",
    "neonatologyPerinatalMedicine", "psychiatry", "pediatricDentistry",
    "surgicalOncology", "infectiousDiseases", "cosmeticDentistry",
    "maternalFetalMedicineOrPerinatology", "spineNeurosurgery",
    "cataractAndAnteriorSegmentSurgery", "pediatricSurgery", "periodontics",
    "retinaAndVitreoretinalOphthalmology", "cardiacSurgery", "rheumatology",
    "preventiveMedicine", "corneaOphthalmology", "glaucomaOphthalmology",
    "vascularSurgery", "refractiveSurgeryOphthalmology", "transplantSurgery",
    "hematology", "colorectalSurgery",
    "oculoplasticsAndReconstructiveOrbitalSurgery", "bariatricSurgery",
    "interventionalRadiology", "allergyAndImmunology",
    "shoulderAndElbowOrthopedicSurgery", "eyeTraumaAndEmergencyEyeCare",
    "geriatrics", "pediatricCriticalCareMedicine", "sleepMedicine",
    "pediatricCardiology", "pediatricOrthopedicSurgery",
    "cardiothoracicSurgery", "reconstructivePlasticSurgery",
    "gynecologicalOncology", "hospiceAndPalliativeInternalMedicine",
    "podiatry", "nuclearMedicine", "neuroOphthalmology",
    "developmentalBehavioralPediatrics", "skullBaseNeurosurgery",
    "maternalAndChildHealth", "pediatricHematologyOncology",
    "pediatricEndocrinology", "pediatricOtolaryngology", "radiationOncology",
    "pediatricGastroenterology", "orthopedicSpineSurgery",
    "pediatricNeurodevelopmentalDisabilities", "pediatricNephrology",
    "pediatricDermatology", "pediatricOphthalmology", "publicHealth",
    "oncology", "footAndAnkleOrthopedicSurgery", "pediatricPulmonology",
    "pediatricAllergyAndImmunology", "pediatricNeurosurgery",
    "pediatricNeurology", "handSurgery", "interventionalCardiology",
    "pediatricEmergencyMedicine", "nutritionAndDietetics",
    "pediatricInfectiousDiseases", "neuroOncology", "audiology",
    "clinicalPsychology", "pediatricRheumatology", "pediatricUrology",
]

# normalized token -> canonical (subset-specialty merges and spelling/wording
# variants; e.g. anesthesiology->anesthesia, ent->otolaryngology,
# paediatrics->pediatrics). Keys are lowercase alphanumeric only.
SPECIALTY_MERGES = {
    # anesthesia
    "anesthesiology": "anesthesia",
    "dentalanesthesia": "anesthesia",
    # internal medicine / geriatrics
    "generalmedicine": "internalMedicine",
    "geriatricsinternalmedicine": "geriatrics",
    "sportsinternalmedicine": "physicalMedicineAndRehabilitation",
    # radiology family
    "diagnosticradiology": "radiology",
    "breastimaging": "radiology",
    "neuroradiology": "radiology",
    "cardiothoracicradiology": "radiology",
    "pediatricradiology": "radiology",
    # gynecology & obstetrics family
    "gynecology": "gynecologyAndObstetrics",
    "obstetricsandmaternitycare": "gynecologyAndObstetrics",
    "obstetricsandgynecology": "gynecologyAndObstetrics",
    "obstetricsandgynaecology": "gynecologyAndObstetrics",
    "urogynecologyandreconstructivepelvissurgery": "gynecologyAndObstetrics",
    "gynecologicalsurgery": "gynecologyAndObstetrics",
    "familyplanningandcomplexcontraception": "gynecologyAndObstetrics",
    "menopauseandmidlifehealth": "gynecologyAndObstetrics",
    "gynecologiconcology": "gynecologicalOncology",
    # ophthalmology family
    "pediatricsandstrabismusophthalmology": "pediatricOphthalmology",
    "paediatricophthalmology": "pediatricOphthalmology",
    "uveitisophthalmology": "ophthalmology",
    "ocularoncology": "ophthalmology",
    "oculoplasty": "oculoplasticsAndReconstructiveOrbitalSurgery",
    # dermatology family
    "cosmeticdermatology": "dermatology",
    "proceduraldermatology": "dermatology",
    "hairandnaildisorders": "dermatology",
    "cosmetology": "dermatology",
    "woundhealinganddermatologicregenerativemedicine": "dermatology",
    "paediatricdermatology": "pediatricDermatology",
    # neurology / psychiatry family
    "headachemedicine": "neurology",
    "epilepsyneurology": "neurology",
    "clinicalneurophysiology": "neurology",
    "movementdisorders": "neurology",
    "vascularneurology": "neurology",
    "braininjuryneurology": "neurology",
    "childneurology": "pediatricNeurology",
    "neuroimmunology": "neurology",
    "cognitiveandbehavioralneurology": "neurology",
    "neurosciences": "neurology",
    "cerebrovascularneurosurgery": "neurosurgery",
    "neuropsychiatry": "psychiatry",
    "addictionpsychiatry": "psychiatry",
    "childandadolescentpsychiatry": "psychiatry",
    "geriatricpsychiatry": "psychiatry",
    "addictionmedicinepm": "psychiatry",
    "psychology": "clinicalPsychology",
    # physical medicine & rehabilitation family
    "painmedicinepmr": "physicalMedicineAndRehabilitation",
    "sportsmedicinepmr": "physicalMedicineAndRehabilitation",
    "physiotherapy": "physicalMedicineAndRehabilitation",
    "pediatricrehabilitationmedicine": "physicalMedicineAndRehabilitation",
    "neuromuscularmedicinepmr": "physicalMedicineAndRehabilitation",
    "spinalcordinjurymedicine": "physicalMedicineAndRehabilitation",
    "amputeeandprostheticsandorthoticsrehabilitation": "physicalMedicineAndRehabilitation",
    "occupationalandvocationalrehabilitation": "physicalMedicineAndRehabilitation",
    "painmanagement": "physicalMedicineAndRehabilitation",
    # orthopedics family
    "orthopedicsportsmedicine": "orthopedicSurgery",
    "jointreconstructionsurgery": "orthopedicSurgery",
    "jointreplacementsurgery": "orthopedicSurgery",
    "orthopediconcology": "orthopedicSurgery",
    "orthopedictraumaandfracturesurgery": "orthopedicSurgery",
    "orthopaedics": "orthopedicSurgery",
    "orthopedics": "orthopedicSurgery",
    # general surgery family
    "hepatopancreatobiliarysurgery": "generalSurgery",
    "uppergiandforegutsurgery": "generalSurgery",
    "surgicalgastroenterology": "generalSurgery",
    "gastrointestinalsurgery": "generalSurgery",
    "endocrinesurgery": "generalSurgery",
    # pathology family
    "clinicalpathology": "pathology",
    "anatomicpathology": "pathology",
    "microbiology": "pathology",
    "oralpathology": "pathology",
    "biochemistry": "pathology",
    "histopathology": "pathology",
    "cancerpathology": "pathology",
    # oncology
    "breastsurgery": "surgicalOncology",
    # gastro / thoracic
    "hepatology": "gastroenterology",
    "generalthoracicsurgery": "cardiothoracicSurgery",
    # ENT family
    "laryngology": "otolaryngology",
    "headandnecksurgeryotolaryngology": "otolaryngology",
    "sleepmedicineotolaryngology": "otolaryngology",
    "rhinology": "otolaryngology",
    "neurotologyandotology": "otolaryngology",
    "ent": "otolaryngology",
    # urology family
    "minimallyinvasivesurgeryandendourology": "urology",
    "renaltransplantationurology": "urology",
    "urologiconcology": "urology",
    "andrologyandmalefertility": "urology",
    "andrology": "urology",
    "genitourinaryreconstructivesurgery": "urology",
    # dentistry family
    "oralmedicine": "dentistry",
    "generaldentistry": "dentistry",
    "dentalimplants": "dentistry",
    "implantology": "dentistry",
    "laserdentistry": "dentistry",
    "restorativedentistry": "dentistry",
    "preventivedentistry": "dentistry",
    "pedodontics": "pediatricDentistry",
    "aestheticdentistry": "cosmeticDentistry",
    # oral & maxillofacial surgery family
    "dentoalveolarsurgery": "oralAndMaxillofacialSurgery",
    "craniofacialandcleftoralmaxillofacialsurgery": "oralAndMaxillofacialSurgery",
    "cosmeticmaxillofacialsurgery": "oralAndMaxillofacialSurgery",
    "orthognathicsurgery": "oralAndMaxillofacialSurgery",
    # plastics / hand family
    "cosmeticsurgery": "plasticSurgery",
    "aestheticandcosmeticsurgery": "plasticSurgery",
    "handorupperextremityandperipheralnervesurgery": "handSurgery",
    "handandupperextremitiessurgery": "handSurgery",
    "handorupperextremitiessurgery": "handSurgery",
    # pediatrics family
    "adolescentmedicine": "pediatrics",
    "paediatrics": "pediatrics",
    "paediatricsurgery": "pediatricSurgery",
    "peadiatricsurgery": "pediatricSurgery",
    # endocrine / fertility
    "diabetology": "endocrinologyAndDiabetesAndMetabolism",
    "endocrinology": "endocrinologyAndDiabetesAndMetabolism",
    "fertility": "reproductiveEndocrinologyAndInfertility",
    # hematology / pulmonology
    "haematology": "hematology",
    "bonemarrowtransplant": "hematology",
    "blooddiseasemanagement": "hematology",
    "pulmonarymedicine": "pulmonology",
    "respiratory": "pulmonology",
    # misc
    "nuclearmedicineandmolecularimaging": "nuclearMedicine",
    "dietetics": "nutritionAndDietetics",
    "podiatricdiabeticlimbsalvageandwoundcare": "podiatry",
    "chronicdiseasepreventionandlifestylemedicine": "preventiveMedicine",
    "burnandtraumaplasticsurgery": "plasticSurgery",
}

# ---------------------------------------------------------------------------
# TODO 2: facility class rules (applied to lowercased facility name)
# ---------------------------------------------------------------------------
# Ordered: first matching rule wins. facilityTypeId/organization_type are
# cross-contaminated with other columns' data (equipment arrays, capability
# prose, GeoJSON) and are deliberately NOT used.
FACILITY_CLASS_RULES = [
    ("pharmacy", r"pharmac|medical store|medical shop|drug store|chemist"),
    ("dental_clinic", r"dental|dentist|orthodont|tooth|teeth"),
    ("diagnostic_center",
     r"diagnos|patholog|laborator|\blab\b|imaging|\bscan|ultrasound|x-?ray|\bmri\b|health check"),
    ("physiotherapy_rehab", r"physio|rehab"),
    ("hospital", r"hospital|nursing home|institut|medical colleg|medical cent"),
    ("clinic", r"clinic|centre|center|care|polyclinic"),
]

# observed cross-contamination: numberDoctors arrays held equipment text,
# capacity arrays held capability text. Kept as a documented guess.
RESCUED_CHANNEL_GUESS = {
    "numberDoctors": "equipment",
    "capacity": "capability",
}

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def norm_token(col):
    """Normalized matching key: lowercase, trim, drop non-alphanumerics."""
    return F.regexp_replace(F.lower(F.trim(col)), r"[^a-z0-9]", "")


def write_table(spark, df, name):
    """Idempotent full-snapshot write; safe to re-run after any failure."""
    df.write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(name)
    print(f"wrote {name}: {spark.table(name).count():,} rows, {len(df.columns)} cols")


# ---------------------------------------------------------------------------
# TODO 1: defensive parse of numberDoctors / capacity
# ---------------------------------------------------------------------------
def parse_scale(spark, gold_table, plat):
    """One row per facility: n_doctors / capacity_value + parse-method flags.

    Categories: int (pure digits), null_literal ('null'), null_or_blank,
    rescued_array (JSON array of strings -> exploded into
    scale_rescued_evidence), empty_or_broken_array, junk (hashes, 'kie', ...).
    """
    g = spark.table(gold_table)

    def parsed(col):
        raw = F.trim(F.col(col).cast("string"))
        arr = F.from_json(raw, ArrayType(StringType()))
        method = (
            F.when(raw.isNull() | (F.length(raw) == 0), F.lit("null_or_blank"))
            .when(F.lower(raw) == F.lit("null"), F.lit("null_literal"))
            .when(raw.rlike(r"^\d+$"), F.lit("int"))
            .when(raw.startswith("[") & (F.size(arr) > 0), F.lit("rescued_array"))
            .when(raw.startswith("["), F.lit("empty_or_broken_array"))
            .otherwise(F.lit("junk")))
        value = F.when(method == F.lit("int"), raw.cast("int"))
        return method, value, arr

    nd_method, nd_value, nd_arr = parsed("numberDoctors")
    cap_method, cap_value, cap_arr = parsed("capacity")

    scale = (g.select("unique_id",
                     nd_value.alias("n_doctors"),
                     nd_method.alias("_n_doctors_method"),
                     cap_value.alias("capacity_value"),
                     cap_method.alias("_capacity_method")))
    write_table(spark, scale, f"{plat}.facility_scale")

    # rescued arrays -> long-format evidence rows (channel is a documented
    # guess from observed cross-contamination; source_column kept for audit)
    nd_resc = (g.select("unique_id", nd_method.alias("m"), nd_arr.alias("a"))
               .where(F.col("m") == "rescued_array")
               .select("unique_id", F.explode("a").alias("token"))
               .withColumn("source_column", F.lit("numberDoctors")))
    cap_resc = (g.select("unique_id", cap_method.alias("m"), cap_arr.alias("a"))
                .where(F.col("m") == "rescued_array")
                .select("unique_id", F.explode("a").alias("token"))
                .withColumn("source_column", F.lit("capacity")))
    rescued = (nd_resc.unionByName(cap_resc)
               .withColumn("channel_guess",
                           F.coalesce(*[F.when(F.col("source_column") == F.lit(c),
                                               F.lit(ch))
                                        for c, ch in RESCUED_CHANNEL_GUESS.items()])))
    write_table(spark, rescued, f"{plat}.scale_rescued_evidence")

    for c in ["numberDoctors", "capacity"]:
        n_resc = (spark.table(f"{plat}.scale_rescued_evidence")
                  .where(F.col("source_column") == c).count())
        print(f"rescued array tokens from {c}: {n_resc}")


# ---------------------------------------------------------------------------
# TODO 2: rebuild facility_class from name + capability text
# ---------------------------------------------------------------------------
def classify_facilities(spark, gold_table, plat):
    """Rule cascade over the facility NAME only, with a capability-text
    fallback for unclassified facilities. facilityTypeId/organization_type
    are ignored (cross-contaminated)."""
    g = spark.table(gold_table)

    name_l = F.lower(F.trim(F.col("name")))
    cap_l = F.lower(F.coalesce(F.col("capability"), F.lit("")))

    name_rule = F.coalesce(*[
        F.when(name_l.rlike(pat), F.lit(cls)) for cls, pat in FACILITY_CLASS_RULES])
    cap_rule = (F.when(cap_l.rlike("hospital"), F.lit("hospital"))
                .when(cap_l.rlike("clinic"), F.lit("clinic"))
                .when(cap_l.rlike("diagnos"), F.lit("diagnostic_center")))

    out = (g.select("unique_id", "name",
                    F.coalesce(name_rule, cap_rule).alias("facility_class"),
                    F.when(name_rule.isNotNull(), F.lit("name_rule"))
                     .when(cap_rule.isNotNull(), F.lit("capability_fallback"))
                     .otherwise(F.lit("unclassified")).alias("class_basis")))
    write_table(spark, out, f"{plat}.facility_class")

    print("facility_class distribution:")
    spark.table(f"{plat}.facility_class") \
        .groupBy("facility_class").count().orderBy(F.desc("count")).show()


# ---------------------------------------------------------------------------
# TODO 3: canonical specialty mapping
# ---------------------------------------------------------------------------
def canonicalize_specialties(spark, gold_table, plat):
    """Explode specialties arrays to normalized tokens (facility grain,
    distinct), map them onto the canonical vocabulary, and materialize:

      specialty_token_map : token, n_facilities, canonical_specialty,
                             map_method in (identity, merge, unmapped)
      facility_specialty  : unique_id, canonical_specialty (distinct)
    """
    g = spark.table(gold_table)

    # safety: merges must target real canonicals, and no key may collide
    canon_set = set(CANONICAL_SPECIALTIES)
    bad_targets = {v for v in SPECIALTY_MERGES.values() if v not in canon_set}
    assert not bad_targets, f"merge targets not in CANONICAL: {bad_targets}"

    arr = F.from_json(F.col("specialties"), ArrayType(StringType()))
    toks = (g.select("unique_id", F.transform(arr, norm_token).alias("t"))
            .select("unique_id", F.array_distinct("t").alias("t"))
            .select("unique_id", F.explode("t").alias("token"))
            .where(F.length("token") > 0))

    token_freq = (toks.groupBy("token")
                  .agg(F.count_distinct("unique_id").alias("n_facilities")))

    mapping = (spark.createDataFrame(
                   [(re.sub(r"[^a-z0-9]", "", c.lower().strip()), c, "identity")
                    for c in CANONICAL_SPECIALTIES],
                   "token string, canonical string, map_method string")
               .unionByName(spark.createDataFrame(
                   [(k, v, "merge") for k, v in SPECIALTY_MERGES.items()],
                   "token string, canonical string, map_method string")))
    dup_keys = (mapping.groupBy("token").count().where(F.col("count") > 1).count())
    assert dup_keys == 0, f"colliding mapping keys: {dup_keys}"

    tok_map = (token_freq.join(mapping, "token", "left")
               .select("token", "n_facilities",
                       F.col("canonical").alias("canonical_specialty"),
                       F.col("map_method")))
    write_table(spark, tok_map, f"{plat}.specialty_token_map")

    fac_spec = (toks.join(mapping, "token")
                .select("unique_id", F.col("canonical").alias("canonical_specialty"))
                .distinct())
    write_table(spark, fac_spec, f"{plat}.facility_specialty")

    # acceptance: >=95% of token volume mapped into <=150 canonicals
    total = token_freq.agg(F.sum("n_facilities")).collect()[0][0]
    mapped = (tok_map.where(F.col("canonical_specialty").isNotNull())
              .agg(F.sum("n_facilities")).collect()[0][0])
    n_canon = (tok_map.where(F.col("canonical_specialty").isNotNull())
               .select("canonical_specialty").distinct().count())
    pct = mapped / total
    print(f"specialty mapping: {mapped:,}/{total:,} facility-token volume "
          f"({pct:.1%}) -> {n_canon} canonical specialties")
    assert pct >= 0.95, f"coverage {pct:.1%} below the 95% acceptance bar"
    assert n_canon <= 150, f"{n_canon} canonical specialties exceeds 150"

    print("top 30 unmapped residue (for future curation):")
    (tok_map.where(F.col("canonical_specialty").isNull())
     .orderBy(F.desc("n_facilities")).limit(30)
     .select("token", "n_facilities")).show(truncate=False)


# ---------------------------------------------------------------------------
# driver
# ---------------------------------------------------------------------------
def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Phase 0 feature layer (TODOs 1-3 of RECOMMENDER_PLAN.md)")
    parser.add_argument(
        "--target-catalog", default=DEFAULT_TARGET_CATALOG,
        help=("catalog holding gold + target for platinum output "
              f"(default: {DEFAULT_TARGET_CATALOG})"))
    args = parser.parse_args(argv)

    spark = SparkSession.builder.getOrCreate()
    spark.sql(f"CREATE SCHEMA IF NOT EXISTS {args.target_catalog}.platinum")
    gold_table = f"{args.target_catalog}.gold.facility_district_health_indicators"
    plat = f"{args.target_catalog}.platinum"
    print(f"source: {gold_table} -> target: {plat}")

    parse_scale(spark, gold_table, plat)
    classify_facilities(spark, gold_table, plat)
    canonicalize_specialties(spark, gold_table, plat)

    # cross-check: every gold facility appears exactly once in each table
    n_gold = spark.table(gold_table).count()
    for t in ["facility_scale", "facility_class"]:
        n = spark.table(f"{plat}.{t}").count()
        assert n == n_gold, f"{t}: {n} rows vs {n_gold} gold facilities"
    print(f"row-count checks passed ({n_gold:,} facilities per grain table)")

    spark.sql(f"""COMMENT ON TABLE {plat}.facility_scale IS
      'One row per facility. n_doctors from numberDoctors, capacity_value from
       capacity (presumed bed count, unverified). _*_method in (int,
       null_literal, null_or_blank, rescued_array, empty_or_broken_array, junk);
       rescued arrays were exploded into platinum.scale_rescued_evidence.'""")
    spark.sql(f"""COMMENT ON TABLE {plat}.facility_class IS
      'One row per facility. Class derived from name rules + capability-text
       fallback ONLY; facilityTypeId/organization_type are cross-contaminated
       and deliberately unused. class_basis in (name_rule, capability_fallback,
       unclassified). Classes: pharmacy, dental_clinic, diagnostic_center,
       physiotherapy_rehab, hospital, clinic.'""")
    spark.sql(f"""COMMENT ON TABLE {plat}.specialty_token_map IS
      'Normalized specialty token -> canonical specialty, with n_facilities and
       map_method in (identity, merge, unmapped). Curated from the observed
       frequency list (top ~220 tokens cover >=95% of facility-token volume).'""")


if __name__ == "__main__":
    main()
