-- Place search data for ONE state (selected from a list, never typed text).
-- Spelling-tolerant matching runs in the browser, so typed place names are never sent to the warehouse.
-- READ-ONLY. One row per PIN (with up to 4 post-office names for town matching) plus one row per district.
-- PIN centres come from the team's cleaned silver.pincode_district_map (src/medallion.py) when present; district
-- aliases from silver.district_alias_map add extra district rows (e.g. an older spelling) pointing at the same centre.
-- @param state STRING = TELANGANA
WITH p AS (
  SELECT cast(pincode as string) pin, upper(trim(district)) district, upper(trim(statename)) state, initcap(lower(trim(officename))) office,
         try_cast(latitude as double) la, try_cast(longitude as double) lo
  FROM databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.india_post_pincode_directory
  WHERE upper(trim(statename)) = upper(:state) AND try_cast(latitude as double) BETWEEN 6 AND 37.6 AND try_cast(longitude as double) BETWEEN 68 AND 97.5
    AND upper(trim(district)) NOT IN ('NA','')),
pins AS (SELECT 'pin' kind, pin code, max(district) district, max(state) state,
    concat_ws(', ', slice(array_sort(collect_set(regexp_replace(office,' (B\\.?O|S\\.?O|H\\.?O)\\.?$',''))),1,4)) towns,
    round(avg(la),4) lat, round(avg(lo),4) lon FROM p GROUP BY pin),
pm AS (SELECT cast(pincode as string) pin, centroid_lat cla, centroid_lon clo FROM labuser_jdw2.silver.pincode_district_map
        WHERE upper(trim(statename)) = upper(:state) AND centroid_lat BETWEEN 6 AND 37.6 AND centroid_lon BETWEEN 68 AND 97.5),
pins2 AS (SELECT pins.kind, pins.code, pins.district, pins.state, pins.towns,
    coalesce(round(pm.cla,4), pins.lat) lat, coalesce(round(pm.clo,4), pins.lon) lon
  FROM pins LEFT JOIN pm ON pm.pin = pins.code),
dists AS (SELECT 'district' kind, '' code, district, max(state) state, '' towns, round(avg(la),4) lat, round(avg(lo),4) lon FROM p GROUP BY district),
alias AS (SELECT 'district' kind, '' code, upper(a.district_key) district, d.state, '' towns, d.lat, d.lon
  FROM labuser_jdw2.silver.district_alias_map a JOIN dists d ON upper(a.tgt_district_key) = d.district
  WHERE upper(a.tgt_state_key) = upper(:state) AND upper(a.district_key) NOT IN (SELECT district FROM dists))
SELECT * FROM dists UNION ALL SELECT * FROM alias UNION ALL SELECT * FROM pins2 ORDER BY kind, district, code
