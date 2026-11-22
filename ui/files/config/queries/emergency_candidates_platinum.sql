-- General emergency-care candidates inside a search bounding box.
-- READ-ONLY. Platinum-backed: facilities with emergencyCare evidence (any confidence band
-- from labuser_jdw2.platinum.facility_service_confidence) OR emergency/casualty/trauma text.
-- Dental clinics and pharmacies are excluded; everything else can be listed.
-- emergency_band is '' when the listing is regex-text-only (shown as "not verified" in the UI).
-- The client rounds the box OUTWARD to a 0.5-degree grid so the exact user location is never sent.
-- @param min_lat DOUBLE = 17.0
-- @param max_lat DOUBLE = 19.0
-- @param min_lon DOUBLE = 78.0
-- @param max_lon DOUBLE = 80.0
WITH f0 AS (
 SELECT unique_id, name, facilityTypeId ft, operatorTypeId op, address_city city, replace(trim(address_zipOrPostcode),' ','') pin,
  latitude_final la, longitude_final lo, officialWebsite,
  centroid_lat g_pla, centroid_lon g_plo, upper(statename) g_state, upper(district) g_dist,
  n_districts_for_pincode g_nd, _coordinates_source g_coord_src, _district_match_method g_match,
  from_json(capability,'array<string>') cap, from_json(procedure,'array<string>') prc, from_json(equipment,'array<string>') eqp,
  lower(coalesce(specialties,'')) spec, lower(coalesce(description,'')) dsc,
  from_json(source_urls,'array<string>') urls, from_json(phone_numbers,'array<string>') phs, from_json(source_ids,'array<string>') sids,
  officialPhone, address_stateOrRegion st_raw,
  regexp_extract(lower(officialWebsite),'^(https?://)?(www\\.)?([^/]+)',3) ow
 FROM labuser_jdw2.gold.facility_district_health_indicators WHERE address_country='India'),
f1 AS (SELECT *, lower(array_join(coalesce(cap,array()),' | ')) capt, lower(array_join(coalesce(prc,array()),' | ')) prct,
  lower(array_join(coalesce(eqp,array()),' | ')) eqpt,
  lower(concat_ws(' ',name,capt,prct,eqpt,spec,dsc)) txt,
  regexp_replace(array_join(concat(coalesce(cap,array()),coalesce(prc,array()),coalesce(eqp,array())),' | '),'(?i)\\b(dr|mr|mrs|ms)\\.?\\s+[a-z]+(\\s+[a-z]+)?','[name removed]') alltxt FROM f0),
pc AS (SELECT unique_id pc_id, g_pla pla, g_plo plo, g_state pstate, g_dist pdist, g_nd pnd FROM f0),
g AS (SELECT f1.*, pc.pstate, pc.pdist, pc.pnd, pc.pla, pc.plo,
  CASE WHEN pc.pla IS NOT NULL AND f1.la IS NOT NULL THEN 2*6371*asin(sqrt(pow(sin(radians(f1.la-pc.pla)/2),2)+cos(radians(pc.pla))*cos(radians(f1.la))*pow(sin(radians(f1.lo-pc.plo)/2),2))) END km_pin
 FROM f1 LEFT JOIN pc ON f1.unique_id=pc.pc_id),
fac AS (SELECT *, coalesce(la between 6 and 37.6 and lo between 68 and 97.5,false) coord_ok FROM g),
cls AS (SELECT unique_id, facility_class fclass FROM labuser_jdw2.platinum.facility_class),
em AS (SELECT unique_id, max(confidence_band) emergency_band FROM labuser_jdw2.platinum.facility_service_confidence WHERE service='emergencyCare' GROUP BY 1),
loc AS (SELECT fac.*, cls.fclass, em.emergency_band,
   CASE WHEN coord_ok THEN la ELSE pla END y, CASE WHEN coord_ok THEN lo ELSE plo END x,
   (NOT coord_ok) OR (g_coord_src='pincode_centroid') loc_approx
 FROM fac LEFT JOIN cls USING (unique_id) LEFT JOIN em USING (unique_id)),
ph AS (SELECT unique_id, substr(regexp_replace(num,'[^0-9]',''),-10) n10 FROM loc LATERAL VIEW explode(phs) e AS num),
phc AS (SELECT n10, count(distinct unique_id) n_fac FROM ph WHERE length(n10)=10 GROUP BY 1)
SELECT l.unique_id, l.name, coalesce(l.fclass,'unknown') facility_class,
  coalesce(l.city,'') city, coalesce(l.pstate, upper(trim(l.st_raw)), '') state,
  round(l.y,5) lat, round(l.x,5) lon, l.loc_approx,
  coalesce(l.emergency_band,'') emergency_band,
  l.alltxt rlike '24/7|24x7|24 x 7|24 hours|24-hour|24 hrs|round the clock|round-the-clock' claims_247,
  l.alltxt rlike 'ambulance' ambulance,
  coalesce(regexp_extract(l.alltxt,'(?i)(.{0,60}(24/7|24x7|24 hours|round the clock|emergency|casualty).{0,60})',1),'') emergency_quote,
  CASE WHEN l.officialPhone IS NOT NULL AND lower(l.officialPhone) NOT IN ('null','') THEN l.officialPhone ELSE '' END official_phone,
  coalesce(p1.n_fac,0) official_phone_shared_by
FROM loc l LEFT JOIN phc p1 ON p1.n10 = substr(regexp_replace(coalesce(l.officialPhone,''),'[^0-9]',''),-10)
WHERE l.y BETWEEN :min_lat AND :max_lat AND l.x BETWEEN :min_lon AND :max_lon
  AND (l.emergency_band IS NOT NULL OR l.alltxt rlike 'emergency|casualty|trauma')
  AND coalesce(l.fclass,'') NOT IN ('dental_clinic','pharmacy')
ORDER BY pow(l.y-(:min_lat+:max_lat)/2,2)+pow(l.x-(:min_lon+:max_lon)/2,2)
LIMIT 60
