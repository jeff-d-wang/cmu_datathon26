-- District context for the results page: the team's district health rating (labuser_jdw2.platinum.district_health_rating,
-- NFHS-5 district survey + facility data). One row for the chosen district, matched on upper-case state and district.
-- band_equal: A (best) .. E, quintiles of composite_equal over all ~706 districts. Read-only.
-- facilities_per_10k_hh is NOT returned: it divides by the NFHS sample size (households surveyed), not by the
-- district's households, so it is not a real density.
-- @param state STRING
-- @param district STRING
SELECT district_name, state_ut, access_status, band_equal, round(composite_equal, 1) composite,
       n_facilities, round(doctors_per_fac, 1) doctors_per_fac, round(critical_cov, 2) critical_cov,
       round(score_A_maternal, 0) score_maternal, round(score_B_immun, 0) score_immunisation,
       round(score_F_ncd, 0) score_ncd, round(score_J_access, 0) score_access,
       (SELECT count(*) FROM labuser_jdw2.platinum.district_health_rating) n_districts
FROM labuser_jdw2.platinum.district_health_rating
WHERE upper(state_key) = upper(:state) AND (upper(district_key) = upper(:district) OR upper(district_name) = upper(:district))
LIMIT 1
