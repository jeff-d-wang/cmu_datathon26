-- The team recommender's ranking (src/recommend.py: geo_candidates + rank), run as the app. Used by the
-- "Team evidence ranking" order option on the results page (the app's own match-score order stays the default).
-- Copied from src/recommend.py on main; the only deviations are marked `deviation:`.
--   score = SUM(weight * band) * 0.95 when the location is a PIN-code centroid,
--   band: high 1.0, medium 0.5, unverified 0.3, low 0.05, no evidence 0.0;
--   critical needs: a facility with a confidence row that is not high/medium for a critical need is excluded
--   (a facility with NO row for it is not, exactly as recommend.py:244 behaves);
--   order: score DESC, nabh DESC, beds DESC, facility class rank DESC NULLS LAST, km ASC (applied in the browser).
-- deviation: needs arrive as one JSON parameter instead of a temp view.
-- deviation: crit_fail is returned as a column instead of filtering, so hybrid_recommend's never-empty ladder
--            (25/50/100/300 km, softened retry) runs in the browser from one query.
-- deviation: one query at the largest radius, nearest :row_cap rows (the ladder only needs the nearest ones).
-- @param lat DOUBLE
-- @param lon DOUBLE
-- @param max_km DOUBLE
-- @param needs_json STRING
-- @param row_cap DOUBLE
WITH needs AS (
  SELECT n.service, n.weight, n.critical
  FROM (SELECT explode(from_json(:needs_json, 'ARRAY<STRUCT<service:STRING,weight:DOUBLE,critical:BOOLEAN>>')) AS n)
), cand AS (
  SELECT * FROM (
    SELECT unique_id, name, pincode, latitude_final, longitude_final,
           _coordinates_source AS coord_source,
           6371.0 * 2 * asin(sqrt(
             pow(sin(radians(latitude_final - :lat) / 2), 2) +
             cos(radians(:lat)) * cos(radians(latitude_final)) *
             pow(sin(radians(longitude_final - :lon) / 2), 2))) AS distance_km
    FROM labuser_jdw2.gold.facility_district_health_indicators
    WHERE latitude_final IS NOT NULL AND longitude_final IS NOT NULL
  ) WHERE distance_km <= :max_km
  ORDER BY distance_km
  LIMIT CAST(:row_cap AS INT)
), pairs AS (
  SELECT c.unique_id, c.name, c.coord_source, c.distance_km, c.latitude_final, c.longitude_final,
         fc.facility_class, fs.capacity_value AS beds,
         nb.unique_id IS NOT NULL AS nabh,
         n.service, n.weight, n.critical,
         cf.confidence_band
  FROM cand c
  CROSS JOIN needs n
  LEFT JOIN labuser_jdw2.platinum.facility_service_confidence cf
    ON cf.unique_id = c.unique_id AND cf.service = n.service
  LEFT JOIN labuser_jdw2.platinum.facility_class fc ON c.unique_id = fc.unique_id
  LEFT JOIN labuser_jdw2.platinum.facility_scale fs ON c.unique_id = fs.unique_id
  LEFT JOIN (SELECT DISTINCT unique_id FROM labuser_jdw2.platinum.facility_service_confidence
             WHERE service = 'nabhAccredited') nb
    ON c.unique_id = nb.unique_id
), crit_fail AS (
  SELECT unique_id FROM pairs
  WHERE critical AND NOT (confidence_band IN ('high', 'medium'))
  GROUP BY unique_id
)
SELECT
  p.unique_id,
  max(p.name) AS name,
  max(p.facility_class) AS facility_class,
  ROUND(max(p.distance_km), 1) AS km,
  max(p.coord_source) AS coord_source,
  max(p.latitude_final) AS lat,
  max(p.longitude_final) AS lon,
  max(p.nabh) AS nabh,
  max(p.beds) AS beds,
  SUM(CASE WHEN p.confidence_band IS NOT NULL THEN 1 ELSE 0 END) AS n_needs_met,
  to_json(map_from_entries(collect_list(struct(p.service, coalesce(p.confidence_band, 'no_evidence'))))) AS matched_json,
  ROUND(SUM(p.weight * CASE p.confidence_band WHEN 'high' THEN 1.0 WHEN 'medium' THEN 0.5
        WHEN 'unverified' THEN 0.3 WHEN 'low' THEN 0.05 ELSE 0.0 END)
    * CASE WHEN max(p.coord_source) = 'pincode_centroid' THEN 0.95 ELSE 1.0 END, 3) AS score,
  max(cf2.unique_id IS NOT NULL) AS crit_fail
FROM pairs p
LEFT JOIN crit_fail cf2 ON cf2.unique_id = p.unique_id
GROUP BY p.unique_id
