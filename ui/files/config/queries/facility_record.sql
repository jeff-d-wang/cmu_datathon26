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
), tok AS (
  -- The record phrases the team pipeline matched to each service: gold procedure/equipment/capability array items,
  -- normalised exactly like src/catalog.py norm_token (lower, non-alphanumerics -> space, collapse spaces, trim),
  -- joined to platinum.channel_token_map on (channel, token), as src/evidence.py does.
  SELECT to_json(map_from_entries(collect_list(struct(service, phrases)))) matched_phrases
  FROM (
    SELECT m.service, slice(array_sort(collect_set(concat(t.channel, '~', regexp_replace(t.item, '(?i)\\b(dr|mr|mrs|ms)\\.?\\s+[a-z]+(\\s+[a-z]+)?', '[name removed]')))), 1, 4) phrases
    FROM (
      SELECT 'procedure' channel, item FROM g LATERAL VIEW explode(from_json(trim(g.`procedure`), 'array<string>')) e AS item
      UNION ALL SELECT 'equipment', item FROM g LATERAL VIEW explode(from_json(trim(g.equipment), 'array<string>')) e AS item
      UNION ALL SELECT 'capability', item FROM g LATERAL VIEW explode(from_json(trim(g.capability), 'array<string>')) e AS item
    ) t
    JOIN labuser_jdw2.platinum.channel_token_map m
      ON m.channel = t.channel AND m.service IS NOT NULL
     AND m.token = trim(regexp_replace(regexp_replace(lower(trim(t.item)), '[^a-z0-9]+', ' '), '\\s+', ' '))
    GROUP BY m.service
  )
), sp AS (
  -- Canonical specialties for this facility (platinum.facility_specialty, from features.py).
  SELECT concat_ws('|', sort_array(collect_set(canonical_specialty))) specialties_canon
  FROM labuser_jdw2.platinum.facility_specialty
  WHERE unique_id = :id
)
SELECT g.unique_id, g.name,
       coalesce(g.description, '') description, coalesce(g.specialties, '') specialties,
       coalesce(g.`procedure`, '') procedures, coalesce(g.equipment, '') equipment,
       coalesce(g.capability, '') capability, coalesce(g.source_urls, '') source_urls,
       coalesce(ch.channels, '') channels, coalesce(sp.specialties_canon, '') specialties_canon,
       coalesce(tok.matched_phrases, '{}') matched_phrases
FROM g CROSS JOIN ch CROSS JOIN sp CROSS JOIN tok
