-- Needs extraction: patient symptoms + context -> weighted need vector over the
-- 192-service catalog. Runs the workspace LLM via ai_query (gpt-oss-120b,
-- temperature 0, failOnError false) -- the same contract as src/recommend.py's
-- extract_needs() (RECOMMENDER_PLAN.md TODO 8).
-- The prompt is built client-side from config/service_registry.json (it embeds the
-- full catalog text) and arrives here as a bound parameter: this file contains no
-- patient text, and the warehouse runs the LLM, not the app server.
-- The model's JSON is parsed in the warehouse and exploded to one row per need
-- {service, weight, critical}, the row contract the client's Needs component reads.
-- The client still validates every service name against the registry (unknowns are
-- dropped and reported, never trusted), merges duplicates (max weight, OR critical),
-- and falls back to the rule-based symptom map on any error.
-- Enabled by the client flag VITE_LLM_EXTRACTION (default off); disabling it keeps
-- the app fully rule-based.
-- @param prompt STRING = ''
WITH q AS (
  SELECT ai_query('system.ai.gpt-oss-120b', :prompt,
      modelParameters => named_struct('temperature', 0),
      failOnError => false) AS out
), parsed AS (
  SELECT from_json(coalesce(q.out.result, '[]'),
      'array<struct<service:string,weight:double,critical:boolean>>') AS needs
  FROM q
)
SELECT need.service AS service, need.weight AS weight, need.critical AS critical
FROM parsed
LATERAL VIEW OUTER explode(needs) e AS need
