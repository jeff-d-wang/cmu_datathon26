-- One facility's own record text, for citing it on the details page (read-only, one row).
-- The record fields (description, specialties, procedure, equipment, capability) are the text the facility's
-- claims were extracted from; source_urls are where that text was found. `channels` lists, per service, which
-- record fields the platinum evidence was found in (platinum.facility_service_evidence), e.g.
-- "dialysis:procedure_claim,capability_claim|icu:equipment_claim".
-- @param id STRING
WITH g AS (
  SELECT unique_id, name, description, specialties, `procedure`, equipment, capability, source_urls,
         yearEstablished, numberDoctors, capacity
  FROM labuser_jdw2.gold.facility_district_health_indicators
  WHERE unique_id = :id
  LIMIT 1
), ch AS (
  SELECT concat_ws('|', collect_list(concat(service, ':', chans))) channels
  FROM (
    SELECT service, concat_ws(',', sort_array(collect_set(channel))) chans
    FROM labuser_jdw2.platinum.facility_service_evidence
    WHERE unique_id = :id
    GROUP BY service
  )
)
SELECT g.unique_id, g.name,
       coalesce(g.description, '') description, coalesce(g.specialties, '') specialties,
       coalesce(g.`procedure`, '') procedures, coalesce(g.equipment, '') equipment,
       coalesce(g.capability, '') capability, coalesce(g.source_urls, '') source_urls,
       coalesce(ch.channels, '') channels
FROM g CROSS JOIN ch
