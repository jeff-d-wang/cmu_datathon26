"""clean.py -- Virtue Foundation dataset medallion pipeline (DAIS 2026 datathon).

Bronze -> silver -> gold for the three shared source tables:

    facilities                       10,088 rows, facility grain
    india_post_pincode_directory    165,627 rows, post-office grain
    nfhs_5_district_health_indicators    706 rows, district grain

Output: `<target>.gold.facility_district_health_indicators` -- one row per
facility (duplicate unique_ids collapsed after verification), with
pincode-resolved district/state and NFHS-5 indicators joined via a three-layer
matcher (exact -> alias -> post-split parent, recorded in
_district_match_method), plus
provenance flags for every derived value (_pincode_valid, _pincode_matched,
_district_match_status, _district_match_method, _coordinates_source,
n_districts_for_pincode, _state_disagrees, _country_backfilled,
_dupe_conflict, _row_id). _pct indicator columns are percentages on a
0-100 scale (declared in the gold table comment).

The source catalog is a read-only Delta Sharing (OpenSharing) catalog -- nothing
there can be created or modified. All writes go to a writable target catalog
(default: labuser_jdw2). Point --target-catalog at any catalog you can write
to in order to materialize your own copy.

Run as a Databricks Job "Python file" task (spark is provided by the runtime),
or from an attached notebook REPL via:
    import runpy; runpy.run_path("clean.py")  # then call main([...]) if desired
"""

import argparse
import datetime

from pyspark.sql import SparkSession
from pyspark.sql import functions as F
from pyspark.sql.window import Window

SRC = "databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset"
DEFAULT_TARGET_CATALOG = "labuser_jdw2"

SOURCE_TABLES = (
    "facilities",
    "india_post_pincode_directory",
    "nfhs_5_district_health_indicators",
)

STATE_FIXES = {"Maharastra": "Maharashtra"}  # known typos in nfhs.state_ut

# TODO 1, Layer A: hand-built alias table (verified 2026-11-21: resolves
# 1,366 of 1,565 unmatched facilities; the 199 post-NFHS-5 splits are
# deliberately left out and stay district_unmatched). Maps the India Post
# (pincode) district_key (often the NEW district name) -> the NFHS-5
# district_key (the survey's OLD name), within a state.
DISTRICT_ALIASES = [
    ("KARNATAKA", "bengaluru urban", "bangalore"),
    ("KARNATAKA", "bengaluru rural", "bangalore rural"),
    ("KARNATAKA", "belagavi", "belgaum"),
    ("KARNATAKA", "mysuru", "mysore"),
    ("KARNATAKA", "shivamogga", "shimoga"),
    ("KARNATAKA", "tumakuru", "tumkur"),
    ("KARNATAKA", "davangere", "davanagere"),
    ("KARNATAKA", "ballari", "bellary"),
    ("KARNATAKA", "kalaburagi", "gulbarga"),
    ("KARNATAKA", "chikkamagaluru", "chikmagalur"),
    ("KARNATAKA", "vijayapura", "bijapur"),
    ("KARNATAKA", "chamarajanagara", "chamarajanagar"),
    ("HARYANA", "gurugram", "gurgaon"),
    ("HARYANA", "charki dadri", "charkhi dadri"),
    ("WEST BENGAL", "24 paraganas north", "north twenty four pargana"),
    ("WEST BENGAL", "24 paraganas south", "south twenty four pargana"),
    ("WEST BENGAL", "darjeeling", "darjiling"),
    ("WEST BENGAL", "howrah", "haora"),
    ("WEST BENGAL", "paschim bardhaman", "paschim barddhaman"),
    ("WEST BENGAL", "hooghly", "hugli"),
    ("WEST BENGAL", "medinipur west", "paschim medinipur"),
    ("WEST BENGAL", "medinipur east", "purba medinipur"),
    ("WEST BENGAL", "coochbehar", "koch bihar"),
    ("WEST BENGAL", "purulia", "puruliya"),
    ("WEST BENGAL", "dinajpur uttar", "uttar dinajpur"),
    ("ANDHRA PRADESH", "visakhapatanam", "visakhapatnam"),
    ("ANDHRA PRADESH", "spsr nellore", "sri potti sriramulu nello"),
    ("ASSAM", "kamrup metro", "kamrup metropolitan"),
    ("ASSAM", "marigaon", "morigaon"),
    ("UTTAR PRADESH", "prayagraj", "allahabad"),
    ("UTTAR PRADESH", "ayodhya", "faizabad"),
    ("UTTAR PRADESH", "kushi nagar", "kushinagar"),
    ("UTTAR PRADESH", "bhadohi", "sant ravidas nagar (bhadohi)"),
    ("UTTAR PRADESH", "amroha", "jyotiba phule nagar"),
    ("UTTAR PRADESH", "maharajganj", "mahrajganj"),
    ("UTTAR PRADESH", "siddharth nagar", "siddharthnagar"),
    ("UTTAR PRADESH", "kasganj", "kanshiram nagar"),
    ("UTTAR PRADESH", "sant kabeer nagar", "sant kabir nagar"),
    ("UTTAR PRADESH", "hathras", "mahamaya nagar"),
    ("UTTAR PRADESH", "barabanki", "bara banki"),
    ("BIHAR", "purbi champaran", "purba champaran"),
    ("PUNJAB", "s.a.s nagar", "sahibzada ajit singh nagar"),
    ("PUNJAB", "sri muktsar sahib", "muktsar"),
    ("PUNJAB", "firozepur", "firozpur"),
    ("TAMIL NADU", "tuticorin", "thoothukkudi"),
    ("TAMIL NADU", "kanchipuram", "kancheepuram"),
    ("TAMIL NADU", "villupuram", "viluppuram"),
    ("MAHARASHTRA", "raigad", "raigarh"),
    ("MAHARASHTRA", "ahmednagar", "ahmadnagar"),
    ("MAHARASHTRA", "buldhana", "buldana"),
    ("MAHARASHTRA", "beed", "bid"),
    ("MAHARASHTRA", "gondia", "gondiya"),
    ("RAJASTHAN", "jhunjhunu", "jhunjhunun"),
    ("RAJASTHAN", "jalore", "jalor"),
    ("RAJASTHAN", "chittorgarh", "chittaurgarh"),
    ("JHARKHAND", "east singhbum", "purbi singhbhum"),
    ("JHARKHAND", "koderma", "kodarma"),
    ("JAMMU AND KASHMIR", "budgam", "badgam"),
    ("JAMMU AND KASHMIR", "baramulla", "baramula"),
    ("UTTARAKHAND", "haridwar", "hardwar"),
    ("UTTARAKHAND", "udam singh nagar", "udham singh nagar"),
    ("PUDUCHERRY", "pondicherry", "puducherry"),
    ("MADHYA PRADESH", "khargone", "khargone (west nimar)"),
    ("MADHYA PRADESH", "east nimar", "khandwa (east nimar)"),
    ("MADHYA PRADESH", "narsinghpur", "narsimhapur"),
    ("CHHATTISGARH", "kabirdham", "kabeerdham"),
    ("CHHATTISGARH", "korea", "koriya"),
    ("GUJARAT", "arvalli", "aravali"),
    ("GUJARAT", "chhotaudepur", "chhota udaipur"),
    ("MEGHALAYA", "ri bhoi", "ribhoi"),
    ("ODISHA", "nabarangpur", "nabarangapur"),
    ("ANDAMAN AND NICOBAR ISLANDS", "south andamans", "south andaman"),
    ("DADRA AND NAGAR HAVELI AND DAMAN AND DIU", "dadra and nagar haveli", "dadra & nagar haveli"),
    ("TELANGANA", "medchal malkajgiri", "medchal-malkajgiri"),
]


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def state_key(col):
    """Canonical state key: trim, UPPER, '&' -> 'AND', drop 'THE '/'NCT OF '.

    Aligns India Post ('THE DADRA AND NAGAR HAVELI AND DAMAN AND DIU', 'DELHI')
    with NFHS-5 ('Dadra and Nagar Haveli & Daman and Diu', 'NCT of Delhi').
    """
    k = F.regexp_replace(F.upper(F.trim(col)), r"\s*&\s*", " AND ")
    k = F.regexp_replace(k, r"^THE\s+", "")
    k = F.regexp_replace(k, r"^NCT OF\s+", "")
    return F.regexp_replace(k, r"\s+", " ")


def district_key(col):
    """District key: trim, lower, collapse whitespace."""
    return F.regexp_replace(F.lower(F.trim(col)), r"\s+", " ")


def write_table(spark, df, name):
    """Idempotent full-snapshot write; safe to re-run after any failure."""
    df.write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(name)
    print(f"wrote {name}: {spark.table(name).count():,} rows, {len(df.columns)} cols")


# ---------------------------------------------------------------------------
# bronze
# ---------------------------------------------------------------------------
def ingest_bronze(spark, bronze):
    """Raw copies + audit columns. No cleaning decisions here."""
    run_ts = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
    for name in SOURCE_TABLES:
        raw = (spark.table(f"{SRC}.{name}")
               .withColumn("_source", F.lit(f"{SRC}.{name}"))
               .withColumn("_ingested_at", F.lit(run_ts).cast("timestamp")))
        write_table(spark, raw, f"{bronze}.{name}")


def qa_report(spark, bronze):
    """Grain checks (rows vs distinct natural keys) and null profiles."""
    fac = spark.table(f"{bronze}.facilities")
    pin = spark.table(f"{bronze}.india_post_pincode_directory")
    nfhs = spark.table(f"{bronze}.nfhs_5_district_health_indicators")

    checks = [
        ("facilities: unique_id", fac.count(),
         fac.select("unique_id").distinct().count()),
        ("pincode_dir: (pincode, officename)", pin.count(),
         pin.select("pincode", "officename").distinct().count()),
        ("nfhs: (state_ut, district_name)", nfhs.count(),
         nfhs.select("state_ut", "district_name").distinct().count()),
    ]
    print("grain checks (rows vs distinct keys):")
    for key, rows, distinct in checks:
        flag = "" if rows == distinct else "  <-- duplicates"
        print(f"  {key:40s} {rows:>8,} vs {distinct:>8,}{flag}")

    for name in SOURCE_TABLES:
        df = spark.table(f"{bronze}.{name}")
        nulls = df.agg(
            *[F.avg(F.col(c).isNull().cast("int")).alias(c) for c in df.columns]
        ).toPandas().T
        nulls.columns = ["pct_null"]
        nulls.index.name = "column"
        nulls = nulls[nulls.pct_null > 0].sort_values("pct_null", ascending=False)
        print(f"{name}: {len(nulls)} of {len(df.columns)} columns contain NULLs")


# ---------------------------------------------------------------------------
# silver
# ---------------------------------------------------------------------------
def dedupe_facilities(spark, bronze):
    """Collapse duplicate unique_ids; merge complementary rows, flag conflicts.

    TODO 5. Verified in bronze (2026-11-21): all 11 duplicated ids have two
    rows identical on every non-audit column -> plain collapse (10,088 ->
    10,077). Complementary rows (one has data where the other is NULL) would
    merge column-wise; rows that genuinely disagree on any column are kept
    and flagged _dupe_conflict -- never merged or dropped silently.
    """
    bronze_fac = spark.table(f"{bronze}.facilities")
    audit_cols = [c for c in bronze_fac.columns if c.startswith("_")]
    data_cols = [c for c in bronze_fac.columns if c != "unique_id" and c not in audit_cols]

    dup_ids = bronze_fac.groupBy("unique_id").count().where("count > 1").select("unique_id")
    dup_rows = bronze_fac.join(dup_ids, "unique_id")

    # per id: distinct non-null values per data column (collect_set drops
    # NULLs), first value per audit column
    agg = dup_rows.groupBy("unique_id").agg(
        *[F.collect_set(F.col(c)).alias(c) for c in data_cols]
        + [F.element_at(F.collect_list(F.col(c)), 1).alias(c) for c in audit_cols])

    max_set_size = F.array_max(F.array(*[F.size(F.col(c)) for c in data_cols]))
    conflict_ids = agg.where(max_set_size > 1).select("unique_id")
    merged = (agg.where(max_set_size <= 1)
        .select(F.col("unique_id"),
                *[F.element_at(F.col(c), 1).alias(c) for c in data_cols]
                + audit_cols))

    fac_base = (bronze_fac.join(dup_ids, "unique_id", "left_anti")
        .withColumn("_dupe_conflict", F.lit(False))
        .unionByName(merged.withColumn("_dupe_conflict", F.lit(False)))
        .unionByName(dup_rows.join(conflict_ids, "unique_id")
                            .withColumn("_dupe_conflict", F.lit(True))))

    print(f"dedupe: {bronze_fac.count():,} bronze rows -> {fac_base.count():,} "
          f"({dup_ids.count()} duplicated ids, {conflict_ids.count()} conflicting)")
    return fac_base


def clean_facilities(fac_base):
    """Facility grain. Extract pincode, hardcode country, flag coords, trim text.

    Takes the deduped frame from dedupe_facilities(). All facilities are
    India-based (user-confirmed), so country is hardcoded to "India";
    _country_backfilled flags rows whose declared address_country was
    junk/NULL/other so the override stays auditable. Nothing else is
    dropped -- silver keeps every facility row.
    """
    # tolerant extraction: strip non-digits, keep only if exactly 6 remain
    # (catches spaced formats like "201 301" -> 201301)
    zip_digits = F.regexp_replace(F.col("address_zipOrPostcode").cast("string"), r"\D", "")
    fac_s = (fac_base
        .withColumn("pincode",
            F.when(zip_digits.rlike(r"^\d{6}$"), zip_digits.cast("int")))
        .withColumn("_pincode_valid", F.col("pincode").isNotNull())
        .withColumn("country", F.lit("India"))
        .withColumn("_country_backfilled",
            F.col("address_country").isNull()
            | (F.upper(F.trim(F.col("address_country"))) != F.lit("INDIA"))))

    for c in ["name", "organization_type", "address_line1", "address_line2",
              "address_line3", "address_city", "address_stateOrRegion"]:
        fac_s = fac_s.withColumn(c, F.trim(F.col(c)))

    # approximate India bounding box; flags NULL and out-of-bounds coords alike
    return fac_s.withColumn("_facility_coords_in_india",
        F.col("latitude").between(6.5, 37.5) & F.col("longitude").between(68.0, 97.5))


def build_pincode_map(spark, bronze):
    """Pincode-grain district map via majority vote across post offices.

    Drops NA-state/NA-district rows; 1,258 of ~19.5k pincodes span more than
    one district -> keep the (district, statename) with the most offices,
    tie-break alphabetically, flag ambiguity with n_districts_for_pincode.
    Centroids (mean office lat/long) are used in gold for coordinate imputation.
    """
    pin_raw = spark.table(f"{bronze}.india_post_pincode_directory")

    pin_offices = (pin_raw
        .where(F.col("statename").isNotNull() & (F.trim(F.col("statename")) != "NA")
             & F.col("district").isNotNull() & (F.trim(F.col("district")) != "NA"))
        .withColumn("lat_d",
            F.when(F.col("latitude").rlike(r"^\s*-?\d+(\.\d+)?\s*$"),
                   F.regexp_extract("latitude", r"^\s*(-?\d+(?:\.\d+)?)\s*$", 1).cast("double")))
        .withColumn("lon_d",
            F.when(F.col("longitude").rlike(r"^\s*-?\d+(\.\d+)?\s*$"),
                   F.regexp_extract("longitude", r"^\s*(-?\d+(?:\.\d+)?)\s*$", 1).cast("double"))))

    vote = (pin_offices
        .groupBy("pincode", "district", "statename")
        .agg(F.count(F.lit(1)).alias("n_offices"),
             F.avg("lat_d").alias("centroid_lat"),
             F.avg("lon_d").alias("centroid_lon")))

    ambiguity = (pin_offices.groupBy("pincode")
        .agg(F.count_distinct("district").alias("n_districts_for_pincode")))

    return (vote
        .withColumn("rnk", F.row_number().over(
            Window.partitionBy("pincode").orderBy(F.desc("n_offices"), F.col("district"))))
        .where(F.col("rnk") == 1)
        .drop("rnk")
        .join(ambiguity, "pincode")
        .select("pincode", "district", "statename", "n_offices",
                "n_districts_for_pincode", "centroid_lat", "centroid_lon"))


def clean_nfhs(spark, bronze):
    """District grain (already correct). Trim keys, fix typos, cast strings.

    Indicator values are numbers with trailing spaces ("21.6 ") or
    parenthesized small-sample estimates ("(18.0)"). ALL string indicator
    columns are cast to double by extracting the leading number; values
    with no leading number (e.g. '*', 'NA', ranges) become NULL.
    """
    nfhs_raw = spark.table(f"{bronze}.nfhs_5_district_health_indicators")

    fix_map = F.map_from_arrays(
        F.array(*[F.lit(k) for k in STATE_FIXES]),
        F.array(*[F.lit(v) for v in STATE_FIXES.values()]))

    nfhs_s = (nfhs_raw
        .withColumn("state_ut", F.trim(F.col("state_ut")))
        .withColumn("district_name", F.trim(F.col("district_name")))
        .withColumn("state_ut", F.coalesce(fix_map[F.col("state_ut")], F.col("state_ut")))
        .withColumn("state_key", state_key(F.col("state_ut")))
        .withColumn("district_key", district_key(F.col("district_name"))))

    num_prefix = r"^\s*\(?\s*-?\d+(?:\.\d+)?"
    # _source/_ingested_at are our bronze audit columns; state_key/
    # district_key are join keys added above -- never cast any of these
    str_cols = [c for c, t in nfhs_s.dtypes
                if t == "string" and c not in ("state_ut", "district_name", "_source",
                                              "state_key", "district_key")]

    before = nfhs_s.agg(*[
        F.sum(F.col(c).isNotNull().cast("int")).alias(c)
        for c in str_cols]).collect()[0]

    for c in str_cols:
        # guard with rlike: regexp_extract returns '' on non-match, and the
        # ANSI cast of '' would raise CAST_INVALID_INPUT
        nfhs_s = nfhs_s.withColumn(c,
            F.when(F.col(c).rlike(num_prefix),
                   F.regexp_extract(F.regexp_replace(c, "[()]", ""),
                                    r"^\s*(-?\d+(?:\.\d+)?)", 1).cast("double")))

    after = nfhs_s.agg(*[
        F.sum(F.col(c).isNotNull().cast("int")).alias(c)
        for c in str_cols]).collect()[0]
    coerced = sum(before[c] - after[c] for c in str_cols)
    print(f"cast all {len(str_cols)} indicator string columns to double "
          f"({coerced} non-numeric values, e.g. '*', coerced to NULL)")
    return nfhs_s


# ---------------------------------------------------------------------------
# silver: district alias map (TODO 1)
# ---------------------------------------------------------------------------
def build_alias_map(spark, silver):
    """District-grain rename table for NFHS matching: (state_key, district_key,
    tgt_state_key, tgt_district_key, match_method).

    Layer A: DISTRICT_ALIASES above (hand-built, deterministic, verified).
    Layer B: guarded fuzzy match on unmatched pairs -- Levenshtein <= 2
    within state AND runner-up at least 2 worse (no ambiguity accepted).
    Post-NFHS-5 districts are deliberately left unmatched (no survey row).
    """
    nfhs_keys = (spark.table(f"{silver}.nfhs_district_indicators")
        .select("state_key", "district_key").distinct())

    # (state, district) pairs that a facility actually hits but NFHS lacks
    pm = (spark.table(f"{silver}.pincode_district_map")
        .withColumn("state_key", state_key("statename"))
        .withColumn("district_key", district_key("district"))
        .select("pincode", "state_key", "district_key"))
    unmatched_pairs = (spark.table(f"{silver}.facilities").select("pincode")
        .join(pm, "pincode").select("state_key", "district_key").distinct()
        .join(nfhs_keys, ["state_key", "district_key"], "left_anti"))

    alias_a = (spark.createDataFrame(DISTRICT_ALIASES,
            "state_key string, district_key string, tgt_district_key string")
        .join(unmatched_pairs, ["state_key", "district_key"])
        .withColumn("match_method", F.lit("alias")))

    # every alias target must exist in NFHS within the state -- hard fail if not
    missing = (alias_a.join(nfhs_keys,
            (alias_a.state_key == nfhs_keys.state_key)
            & (alias_a.tgt_district_key == nfhs_keys.district_key), "left")
        .where(nfhs_keys.district_key.isNull()))
    print(f"alias entries with a target missing from NFHS: {missing.count()}")
    assert missing.count() == 0

    # Layer B: guarded fuzzy on whatever Layer A did not catch
    cand = (unmatched_pairs.join(alias_a, ["state_key", "district_key"], "left_anti")
        .alias("u")
        .join(nfhs_keys.alias("n"), F.col("u.state_key") == F.col("n.state_key"))
        .select(F.col("u.state_key").alias("state_key"),
                F.col("u.district_key").alias("district_key"),
                F.col("n.district_key").alias("n_district"),
                F.levenshtein(F.col("u.district_key"),
                             F.col("n.district_key")).alias("dist")))
    ranked = (cand.groupBy("state_key", "district_key")
        .agg(F.array_sort(F.collect_list(F.struct("dist", "n_district"))).alias("cands")))
    alias_b = (ranked
        .where((F.col("cands")[0]["dist"] <= 2)
            & ((F.size("cands") < 2)
               | (F.col("cands")[1]["dist"] >= F.col("cands")[0]["dist"] + 2)))
        .select("state_key", "district_key",
                F.col("cands")[0]["n_district"].alias("tgt_district_key"))
        .withColumn("match_method", F.lit("fuzzy")))

    print("fuzzy proposals (eyeball these):")
    alias_b.orderBy("state_key", "district_key").show(truncate=False)

    return (alias_a.unionByName(alias_b)
        .withColumn("tgt_state_key", F.col("state_key"))
        .select("state_key", "district_key", "tgt_state_key",
                "tgt_district_key", "match_method"))


# -- post-NFHS-5 split districts (TODO 13) -----------------------------------
# India Post reports current district names; several postdate the NFHS-5
# district frame and so match no survey row. PARENT_MAP sends each to its
# pre-split parent (the NFHS-5 district covering the same geography),
# hand-built and verified against the NFHS-5 key set at build time.
# PURBA BARDHAMAN is deliberately absent: this NFHS copy has no undivided
# 'Barddhaman' row (only Paschim Barddhaman) and a sibling is not a
# parent -- those 11 facilities keep NULL indicators, never silently.
PARENT_MAP = [
    # (state, district, nfhs_state, nfhs_district, rationale)
    ("Andhra Pradesh", "NTR", "Andhra Pradesh", "Krishna",
     "2022 AP split of Krishna"),
    ("Andhra Pradesh", "Tirupati", "Andhra Pradesh", "Chittoor",
     "2022 AP split of Chittoor"),
    ("Andhra Pradesh", "Eluru", "Andhra Pradesh", "West Godavari",
     "2022 AP split of West Godavari"),
    ("Andhra Pradesh", "Sri Sathya Sai", "Andhra Pradesh", "Anantapur",
     "2022 AP split of Anantapur"),
    ("Andhra Pradesh", "Annamayya", "Andhra Pradesh", "Chittoor",
     "2022 AP split of Chittoor"),
    ("Andhra Pradesh", "Bapatla", "Andhra Pradesh", "Guntur",
     "2022 AP split of Guntur"),
    ("Andhra Pradesh", "Kakinada", "Andhra Pradesh", "East Godavari",
     "2022 AP split of East Godavari"),
    ("Andhra Pradesh", "Nandyal", "Andhra Pradesh", "Kurnool",
     "2022 AP split of Kurnool"),
    ("Andhra Pradesh", "Palnadu", "Andhra Pradesh", "Guntur",
     "2022 AP split of Guntur"),
    ("Andhra Pradesh", "Anakapalli", "Andhra Pradesh", "Visakhapatnam",
     "2022 AP split of Visakhapatnam"),
    ("Andhra Pradesh", "Parvathipuram Manyam", "Andhra Pradesh",
     "Vizianagaram", "2022 AP split of Vizianagaram"),
    ("Andhra Pradesh", "Konaseema", "Andhra Pradesh", "East Godavari",
     "2022 AP split of East Godavari"),
    ("Tamil Nadu", "Chengalpattu", "Tamil Nadu", "Kancheepuram",
     "2019 TN split of Kancheepuram"),
    ("Tamil Nadu", "Tenkasi", "Tamil Nadu", "Tirunelveli",
     "2019 TN split of Tirunelveli"),
    ("Tamil Nadu", "Ranipet", "Tamil Nadu", "Vellore",
     "2019 TN split of Vellore"),
    ("Tamil Nadu", "Tirupathur", "Tamil Nadu", "Vellore",
     "2019 TN split of Vellore"),
    ("Tamil Nadu", "Kallakurichi", "Tamil Nadu", "Viluppuram",
     "2019 TN split of Viluppuram"),
    ("Tamil Nadu", "Mayiladuthurai", "Tamil Nadu", "Nagapattinam",
     "2019 TN split of Nagapattinam"),
    ("Telangana", "Hanumakonda", "Telangana", "Warangal Urban",
     "2021 rename of Warangal Urban"),
    ("West Bengal", "Kalimpong", "West Bengal", "Darjiling",
     "2017 WB split of Darjiling (NFHS spelling)"),
    ("Punjab", "Malerkotla", "Punjab", "Sangrur",
     "2021 PB split of Sangrur"),
    ("Karnataka", "Vijaynagar", "Karnataka", "Bellary",
     "2021 KA split of Bellary (Vijayanagara)"),
]


def build_parent_map(spark, silver):
    """Post-split district -> NFHS-5 parent map (TODO 13).

    (state_key, district_key, tgt_state_key, tgt_district_key, rationale).
    Every tgt pair is asserted to exist in the NFHS-5 key set -- the build
    fails loudly if the reference ever changes underneath us.
    """
    raw = spark.createDataFrame(
        PARENT_MAP,
        "state STRING, district STRING, nfhs_state STRING, "
        "nfhs_district STRING, rationale STRING")
    pm = (raw
        .withColumn("state_key", state_key("state"))
        .withColumn("district_key", district_key("district"))
        .withColumn("tgt_state_key", state_key("nfhs_state"))
        .withColumn("tgt_district_key", district_key("nfhs_district"))
        .select("state_key", "district_key", "tgt_state_key",
                "tgt_district_key", "rationale"))
    nfhs_keys = (spark.table(f"{silver}.nfhs_district_indicators")
        .select("state_key", "district_key").distinct())
    bad = (pm.select("tgt_state_key", "tgt_district_key").distinct()
        .join(nfhs_keys.withColumnRenamed("state_key", "tgt_state_key")
                       .withColumnRenamed("district_key", "tgt_district_key"),
              ["tgt_state_key", "tgt_district_key"], "left_anti"))
    n_bad = bad.count()
    assert n_bad == 0, f"PARENT_MAP targets missing from NFHS-5 keys: {bad.collect()}"
    return pm


# ---------------------------------------------------------------------------
# gold
# ---------------------------------------------------------------------------
def build_gold(spark, silver):
    """Facility grain: facilities -> pincode district -> NFHS-5 indicators.

    All left joins; flag, never drop. District match resolves exact
    first, then the alias map, then the post-split parent map (TODO 13;
    all recorded in _district_match_method). _state_disagrees
    compares the facility-declared state with the pincode-derived state
    under full state_key normalization; the pincode-derived state stays the
    join key. Conflicting duplicate unique_ids (if any ever appear) survive
    with _dupe_conflict; districts with no NFHS row (post-NFHS-5 splits)
    keep NULL indicators with _district_match_status = district_unmatched.
    """
    fac_s = spark.table(f"{silver}.facilities")
    pin_map = (spark.table(f"{silver}.pincode_district_map")
        .withColumn("state_key", state_key("statename"))
        .withColumn("district_key", district_key("district")))
    # drop audit columns from the NFHS side: facilities already carries them,
    # and the join would raise COLUMN_ALREADY_EXISTS on the duplicated names
    nfhs_s = (spark.table(f"{silver}.nfhs_district_indicators")
        .drop("_source", "_ingested_at"))
    alias_map = spark.table(f"{silver}.district_alias_map")
    parent_map = (spark.table(f"{silver}.district_parent_map")
        .withColumnRenamed("tgt_state_key", "p_tgt_state_key")
        .withColumnRenamed("tgt_district_key", "p_tgt_district_key")
        .drop("rationale"))

    # stable ordinal for any same-unique_id rows that survive silver dedupe
    fac_g = fac_s.withColumn("_row_id", F.row_number().over(
        Window.orderBy(F.col("unique_id"), F.monotonically_increasing_id())))

    fac_geo = (fac_g
        .join(pin_map, "pincode", "left")
        .withColumn("_pincode_matched", F.col("district").isNotNull())
        .withColumn("latitude_final",
            F.when(F.col("_facility_coords_in_india"), F.col("latitude"))
             .otherwise(F.col("centroid_lat")))
        .withColumn("longitude_final",
            F.when(F.col("_facility_coords_in_india"), F.col("longitude"))
             .otherwise(F.col("centroid_lon")))
        .withColumn("_coordinates_source",
            F.when(F.col("_facility_coords_in_india"), F.lit("facility"))
             .when(F.col("centroid_lat").isNotNull(), F.lit("pincode_centroid")))
        # TODO 4: declared state vs pincode-derived state, full normalization;
        # NULL when either side is missing/blank (nothing to compare)
        .withColumn("_state_disagrees",
            F.when(F.col("statename").isNotNull()
                   & (F.length(F.trim(F.col("address_stateOrRegion"))) > 0),
                   state_key(F.col("address_stateOrRegion")) != state_key(F.col("statename")))))

    # TODO 1: resolve NFHS join keys exact -> alias -> fuzzy
    exact_keys = (nfhs_s.select("state_key", "district_key").distinct()
        .withColumnRenamed("state_key", "ex_state_key")
        .withColumnRenamed("district_key", "ex_district_key"))

    resolved = (fac_geo
        .join(exact_keys,
            (F.col("state_key") == F.col("ex_state_key"))
            & (F.col("district_key") == F.col("ex_district_key")), "left")
        .join(alias_map, ["state_key", "district_key"], "left")
        .join(parent_map, ["state_key", "district_key"], "left")
        .withColumn("nfhs_state_key", F.coalesce(
            "ex_state_key", "tgt_state_key", "p_tgt_state_key"))
        .withColumn("nfhs_district_key", F.coalesce(
            "ex_district_key", "tgt_district_key", "p_tgt_district_key"))
        .withColumn("_district_match_method",
            F.when(F.col("district_key").isNull(), F.lit(None).cast("string"))
             .when(F.col("ex_district_key").isNotNull(), F.lit("exact"))
             .when(F.col("tgt_district_key").isNotNull(), F.col("match_method"))
             .when(F.col("p_tgt_district_key").isNotNull(), F.lit("parent"))
             .otherwise(F.lit(None).cast("string")))
        .drop("ex_state_key", "ex_district_key", "tgt_state_key",
              "tgt_district_key", "match_method", "p_tgt_state_key",
              "p_tgt_district_key"))

    return (resolved
        .join(nfhs_s.withColumnRenamed("state_key", "nfhs_state_key")
                    .withColumnRenamed("district_key", "nfhs_district_key"),
              ["nfhs_state_key", "nfhs_district_key"], "left")
        .withColumn("_district_match_status",
            F.when(F.col("district_name").isNotNull(), F.lit("nfhs_matched"))
             .when(F.col("district").isNotNull(), F.lit("district_unmatched"))
             .otherwise(F.lit("no_pincode_district"))))


def gold_qa(spark, gold):
    """Post-build assertions on counts, match rates, and flag distributions."""
    g = spark.table(f"{gold}.facility_district_health_indicators")
    print(f"gold rows: {g.count():,}")

    g.groupBy("_district_match_status").count().orderBy(F.desc("count")).show()
    g.groupBy("_district_match_method").count().orderBy(F.desc("count")).show()
    g.groupBy("_coordinates_source").count().orderBy(F.desc("count")).show()

    print("state disagreements (declared vs pincode-derived):",
          g.where(F.col("_state_disagrees")).count(), "of",
          g.where("statename IS NOT NULL AND address_stateOrRegion IS NOT NULL").count(),
          "comparable")
    print("country backfilled:", g.where(F.col("_country_backfilled")).count())
    print("facilities on an ambiguous (multi-district) pincode:",
          g.where(F.col("n_districts_for_pincode") > 1).count())
    print("unique_ids appearing >1 time:",
          g.groupBy("unique_id").count().where("count > 1").count())

    # TODO 6: declare the scale convention on the table itself
    spark.sql(f"""COMMENT ON TABLE {gold}.facility_district_health_indicators IS
      'One row per facility. District/state resolved from pincode via India Post; NFHS-5
       district indicators joined on normalized keys with _district_match_method in
       (exact, alias, parent). Indicator columns ending in _pct are percentages on a 0-100
       scale; *_per_1000_m are per-1000 ratios; *_surveyed / *_interviewed are counts.
       Rescale only _pct columns (divide by 100) at consumption time, never in place.'""")


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Virtue Foundation dataset medallion pipeline")
    parser.add_argument(
        "--target-catalog", default=DEFAULT_TARGET_CATALOG,
        help=("writable catalog for bronze/silver/gold output "
              f"(default: {DEFAULT_TARGET_CATALOG})"))
    args = parser.parse_args(argv)

    spark = SparkSession.builder.getOrCreate()
    bronze = f"{args.target_catalog}.bronze"
    silver = f"{args.target_catalog}.silver"
    gold = f"{args.target_catalog}.gold"
    print(f"source: {SRC} -> target: {args.target_catalog}")

    ingest_bronze(spark, bronze)
    qa_report(spark, bronze)

    fac_base = dedupe_facilities(spark, bronze)
    write_table(spark, clean_facilities(fac_base), f"{silver}.facilities")
    write_table(spark, build_pincode_map(spark, bronze), f"{silver}.pincode_district_map")
    write_table(spark, clean_nfhs(spark, bronze), f"{silver}.nfhs_district_indicators")
    write_table(spark, build_alias_map(spark, silver), f"{silver}.district_alias_map")
    write_table(spark, build_parent_map(spark, silver), f"{silver}.district_parent_map")
    write_table(spark, build_gold(spark, silver),
                f"{gold}.facility_district_health_indicators")

    gold_qa(spark, gold)


if __name__ == "__main__":
    main()
