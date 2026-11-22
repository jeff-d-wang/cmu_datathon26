-- Engine (Alvin's method) candidates from the team's CLEAN table. READ-ONLY. Scoring happens in the browser.
-- Source: labuser_jdw2.gold.facility_district_health_indicators. Items are kept as one string per field joined by chr(31)
-- (JSON-array syntax stripped). Only items that match at least one service pattern of the method are sent (they are the only
-- ones that can become evidence), de-duplicated and capped per field (25 items) and in length (300 chars), to keep a dense-city payload under ~900 KB.
-- @param min_lat DOUBLE = 26.0
-- @param max_lat DOUBLE = 28.0
-- @param min_lon DOUBLE = 75.0
-- @param max_lon DOUBLE = 77.0
WITH f AS (
 SELECT unique_id, name, facilityTypeId, organization_type, address_city, address_stateOrRegion, pincode, officialPhone, officialWebsite,
  try_cast(capacity AS DOUBLE) capacity,
  latitude_final la, longitude_final lo, centroid_lat, centroid_lon, _coordinates_source, _pincode_valid, _pincode_matched,
  from_json(procedure,'array<string>') prc, from_json(equipment,'array<string>') eqp, from_json(capability,'array<string>') cap,
  from_json(specialties,'array<string>') spec, description,
  '(?i)emergency|casualty|trauma cent|\\becg\\b|\\bekg\\b|electrocardiogra|x-?ray|radiograph|\\bct\\b|computed tomograph|\\bmri\\b|magnetic resonance|ultrasound|sonograph|\\busg\\b|laborator|patholog|blood test|fracture|plaster|\\bcasts?\\b|splint|inpatient|in-patient|\\bipd\\b|\\b\\d+[\\s-]*bed|\\bicu\\b|intensive care|critical care|operation theat|operating (room|theat)|cath ?lab|catheteri[sz]ation lab|angioplast|c[- ]?section|ca?esarean|\\blscs\\b|dialy' rx
 FROM labuser_jdw2.gold.facility_district_health_indicators
 WHERE address_country = 'India' AND latitude_final BETWEEN :min_lat AND :max_lat AND longitude_final BETWEEN :min_lon AND :max_lon)
SELECT unique_id id, name, coalesce(address_city,'') city, coalesce(address_stateOrRegion,'') state, coalesce(cast(pincode AS STRING),'') pin,
  coalesce(facilityTypeId,'') facility_type, coalesce(organization_type,'') organization_type, capacity,
  round(la,5) lat, round(lo,5) lon, round(centroid_lat,5) centroid_lat, round(centroid_lon,5) centroid_lon,
  coalesce(_coordinates_source,'') coord_source, cast(_pincode_valid AS STRING) pincode_valid, cast(_pincode_matched AS STRING) pincode_matched,
  coalesce(officialPhone,'') phone, coalesce(officialWebsite,'') website,
  coalesce(array_join(transform(filter(coalesce(spec,array()), x -> x IS NOT NULL AND trim(x) <> ''), x -> substr(x,1,60)), chr(31)),'') specialties,
  coalesce(array_join(slice(array_distinct(transform(filter(coalesce(prc,array()), x -> x IS NOT NULL AND trim(x) <> '' AND x rlike rx), x -> substr(x,1,300))),1,25), chr(31)),'') procedure,
  coalesce(array_join(slice(array_distinct(transform(filter(coalesce(eqp,array()), x -> x IS NOT NULL AND trim(x) <> '' AND x rlike rx), x -> substr(x,1,300))),1,25), chr(31)),'') equipment,
  coalesce(array_join(slice(array_distinct(transform(filter(coalesce(cap,array()), x -> x IS NOT NULL AND trim(x) <> '' AND x rlike rx), x -> substr(x,1,300))),1,25), chr(31)),'') capability,
  CASE WHEN description rlike rx THEN substr(description,1,500) ELSE '' END description
FROM f
ORDER BY pow(la-(:min_lat+:max_lat)/2,2)+pow(lo-(:min_lon+:max_lon)/2,2)
LIMIT 300
