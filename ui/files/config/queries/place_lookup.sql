-- Place search data for ONE state (selected from a list, never typed text).
-- Spelling-tolerant matching runs in the browser, so typed place names are never sent to the warehouse.
-- READ-ONLY. One row per PIN (with up to 4 post-office names for town matching) plus one row per district.
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
dists AS (SELECT 'district' kind, '' code, district, max(state) state, '' towns, round(avg(la),4) lat, round(avg(lo),4) lon FROM p GROUP BY district)
SELECT * FROM dists UNION ALL SELECT * FROM pins ORDER BY kind, district, code
