-- State list for the place selector (READ-ONLY, aggregated).
SELECT upper(trim(statename)) state, count(distinct pincode) pins
FROM databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.india_post_pincode_directory
WHERE upper(trim(statename)) NOT IN ('NA','') AND statename IS NOT NULL
GROUP BY 1 ORDER BY 1
