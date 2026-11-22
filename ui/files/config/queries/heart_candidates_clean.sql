-- CLEAN variant of heart_candidates
-- Source: labuser_jdw2.gold.facility_district_health_indicators (team's cleaned gold table; read-only). Same output columns as the raw query.
-- Heart-care finder: heart-facility candidates inside a search bounding box.
-- READ-ONLY. Cleaning + heart-label logic copied from sql/heart/hb.sql (do not re-derive).
-- The client rounds the box OUTWARD to a 0.5-degree grid so the exact user location is never sent.
-- @param min_lat DOUBLE = 17.0
-- @param max_lat DOUBLE = 19.0
-- @param min_lon DOUBLE = 78.0
-- @param max_lon DOUBLE = 80.0
WITH f0 AS (
 SELECT unique_id, name, facilityTypeId ft, operatorTypeId op, address_city city, replace(trim(address_zipOrPostcode),' ','') pin,
  latitude_final la, longitude_final lo, officialWebsite,
  centroid_lat g_pla, centroid_lon g_plo, upper(statename) g_state, upper(district) g_dist, n_districts_for_pincode g_nd, _coordinates_source g_coord_src, _district_match_method g_match, recency_of_page_update rec, post_metrics_most_recent_social_media_post_date spd,
  from_json(capability,'array<string>') cap, from_json(procedure,'array<string>') prc, from_json(equipment,'array<string>') eqp,
  lower(coalesce(specialties,'')) spec, lower(coalesce(description,'')) dsc,
  from_json(source_urls,'array<string>') urls, from_json(phone_numbers,'array<string>') phs, from_json(source_ids,'array<string>') sids,
  try_cast(numberDoctors as int) docs, affiliationTypeIds aff, email, websites, officialPhone, address_line1 addr1, facebookLink fb, address_stateOrRegion st_raw, description desc_raw, try_cast(capacity as int) beds, try_cast(yearEstablished as int) yr,
  regexp_extract(lower(officialWebsite),'^(https?://)?(www\\.)?([^/]+)',3) ow
 FROM labuser_jdw2.gold.facility_district_health_indicators WHERE address_country='India'),
f1 AS (SELECT *, lower(array_join(coalesce(cap,array()),' | ')) capt, lower(array_join(coalesce(prc,array()),' | ')) prct, lower(array_join(coalesce(eqp,array()),' | ')) eqpt,
  (coalesce(size(cap),0)=50 OR coalesce(size(prc),0)=50 OR coalesce(size(eqp),0)=50) list_truncated,
  coalesce(size(cap),0)+coalesce(size(prc),0)+coalesce(size(eqp),0) n_claims FROM f0),
dom AS (SELECT unique_id, regexp_extract(lower(x),'^https?://(www\\.)?([^/]+)',2) d FROM f0 LATERAL VIEW explode(urls) e AS x WHERE x rlike '^https?'),
domc AS (SELECT unique_id, d, CASE WHEN d rlike 'practo|justdial|medindia|onefivenine|proptiger|hexahealth|mappls|docindia|policyx|lybrate|indiamart|latlong|medicineindia|healthfrog|sulekha|credihealth|lbb|tripadvisor|google|yellowpages|mouthshut|nearbuy|bajajfinserv|zocdoc|1mg|pharmeasy' THEN 'dir' WHEN d rlike 'facebook|linkedin|instagram|twitter|youtube|x\\.com' THEN 'soc' WHEN d rlike '\\.gov\\.in|\\.nic\\.in|\\.edu|\\.ac\\.in|who\\.int|icmr|mohfw' THEN 'gov' WHEN d rlike 'insur|policy|star ?health|hdfc|icici|lic\\.|healthindia|medi ?assist|paramount|mdindia' THEN 'ins' ELSE 'own' END cls FROM dom),
src AS (SELECT unique_id, count(distinct case when cls='own' then d end) n_own, max(int(cls='own')) has_own, max(int(cls='gov')) has_gov, max(int(cls in ('dir','soc','ins'))) has_dir FROM domc GROUP BY 1),
pc AS (SELECT unique_id pc_id, g_pla pla, g_plo plo, g_state pstate, g_dist pdist, g_nd pnd FROM f0),
g AS (SELECT f1.*, coalesce(src.n_own,0) n_own, coalesce(src.has_own,0) has_own, coalesce(src.has_gov,0) has_gov, coalesce(src.has_dir,0) has_dir,
  CASE WHEN src.has_own=1 THEN 'non_directory' WHEN src.has_gov=1 THEN 'gov' WHEN src.has_dir=1 THEN 'directory_only' ELSE 'none' END src_class,
  coalesce(size(array_distinct(transform(phs, x -> substr(regexp_replace(x,'[^0-9]',''),-10)))),0) n_ph,
  coalesce(size(array_distinct(sids)),0) n_sid, pc.pstate, pc.pdist, pc.pnd, pc.pla, pc.plo,
  CASE WHEN pc.pla IS NOT NULL AND f1.la IS NOT NULL THEN 2*6371*asin(sqrt(pow(sin(radians(f1.la-pc.pla)/2),2)+cos(radians(pc.pla))*cos(radians(f1.la))*pow(sin(radians(f1.lo-pc.plo)/2),2))) END km_pin,
  coalesce(lower(name) rlike 'hospital.*( and |&|/|,).*(hospital|clinic|nursing home)',false) name2
 FROM f1 LEFT JOIN src USING (unique_id) LEFT JOIN pc ON f1.unique_id=pc.pc_id),
fac AS (SELECT *, int(coalesce(km_pin>200,false))+int(n_own>=10)+int(n_ph>=10)+int(n_sid>=10)+int(name2) n_merge_sig,
  int(coalesce(km_pin>200,false))+int(n_own>=10)+int(n_ph>=10)+int(n_sid>=10)+int(name2)>=3 merge_suspect,
  coalesce(la between 6 and 37.6 and lo between 68 and 97.5,false) coord_ok FROM g)
, items AS (SELECT unique_id, 'capability' fld, x FROM fac LATERAL VIEW explode(cap) e AS x
  UNION ALL SELECT unique_id, 'procedure', x FROM fac LATERAL VIEW explode(prc) e AS x
  UNION ALL SELECT unique_id, 'equipment', x FROM fac LATERAL VIEW explode(eqp) e AS x
  UNION ALL SELECT unique_id, 'specialties', x FROM fac LATERAL VIEW explode(from_json(spec,'array<string>')) e AS x),
lab AS (SELECT * FROM VALUES
 ('L01 Heart specialist (cardiology)','cardiolog',''),
 ('L02 Heart tests (ECG / TMT / Holter)','\\becg\\b|\\bekg\\b|electrocardiog|\\btmt\\b|treadmill|cardiac stress|stress test|holter',''),
 ('L03 Heart scan (Echo)','echocardiog|\\b2[- ]?d ?echo|\\becho\\b|transo?esophageal echo|\\btee\\b',''),
 ('L04 Angiography / cath lab','cath ?lab|catheteri[sz]ation lab|cardiac catheteri|(coronary|cardiac|heart) angiogra|angiogra','retina|fluorescein|\\beye\\b|ocular|\\bct\\b|computed|\\bmr\\b|mri|cerebral|neuro|peripheral|renal|limb|venous|pulmonary angiogra'),
 ('L05 Angioplasty and stents','angioplast|\\bptca\\b|\\bpci\\b|coronary stent','peripheral|carotid|renal|venous|limb|femoral|iliac|cerebral|neuro|intracranial|\\bvein'),
 ('L06 Bypass surgery (CABG)','\\bcabg\\b|coronary artery bypass|(heart|coronary|cardiac) bypass|bypass graft','gastric|bariatric|weight|roux|mini bypass'),
 ('L07 Heart and valve surgery','cardiac ?surg|cardiothoracic ?surg|cardio ?thoracic and vascular|\\bctvs\\b|\\bcvts\\b|heart surg|open[- ]heart|valve (replace|repair|surg)|\\btavr\\b|\\btavi\\b|valvotomy|valvuloplasty|heart transplant','radiolog|anaesthe|anesthe'),
 ('L08 Heart rhythm and pacemaker','pacemaker|icd implant|implantable cardioverter|cardiac resynchron|electrophysiolog|cardiac ablation|arrhythmi|\\bep lab','intercostal'),
 ('L09 Cardiac intensive care (CCU)','\\biccu\\b|\\bcicu\\b|\\bccu\\b|cardiac (icu|intensive|critical)|coronary care','critical care unit \\(ccu\\)'),
 ('L10 Heart failure care','heart failure|cardiomyopath|\\blvad\\b|ventricular assist',''),
 ('L11 Children''s heart care','pa?ediatric ?cardi|congenital heart|congenital cardiac|fetal echo|foetal echo',''),
 ('L12 Cardiac rehabilitation','cardiac rehab|cardio(vascular|pulmonary)? rehab','')
 AS t(label, rx, excl)),
li AS (SELECT i.unique_id, i.fld, i.x, lower(trim(i.x)) s, l.label FROM items i JOIN lab l
  ON lower(i.x) rlike l.rx AND NOT (l.excl<>'' AND lower(i.x) rlike l.excl)
  WHERE NOT (l.label LIKE 'L04%' AND i.fld='equipment' AND NOT lower(i.x) rlike 'cath'))
, hl AS (SELECT unique_id, collect_set(label) labels FROM li GROUP BY 1),
fx AS (SELECT fac.*, lower(concat_ws(' ',name,capt,prct,eqpt,spec,dsc)) txt, hl.labels, hl.labels IS NOT NULL is_heart,
  coalesce(exists(hl.labels, l -> l rlike '^L0[45]'),false) cathlab,
  coalesce(exists(hl.labels, l -> l rlike '^L0[67]'),false) surgery,
  coalesce(exists(hl.labels, l -> l rlike '^L0[45678]'),false) interventional
 FROM fac LEFT JOIN hl USING (unique_id)),
hf AS (SELECT * FROM fx WHERE is_heart)

, ph AS (SELECT unique_id, substr(regexp_replace(x,'[^0-9]',''),-10) n10 FROM fac LATERAL VIEW explode(phs) e AS x),
phc AS (SELECT n10, count(distinct unique_id) n_fac FROM ph WHERE length(n10)=10 GROUP BY 1),
loc AS (SELECT fx.*,
   CASE WHEN coord_ok AND (km_pin IS NULL OR km_pin<=50) THEN la ELSE pla END y,
   CASE WHEN coord_ok AND (km_pin IS NULL OR km_pin<=50) THEN lo ELSE plo END x,
   NOT (coord_ok AND (km_pin IS NULL OR km_pin<=50)) loc_approx,
   lower(name) rlike '\\beye\\b|netra|nethra|vision|dental|dentist|\\bent\\b|skin|derma|hair|ivf|fertility|homoeo|homeo|ayurved|unani|physio' single_specialty_name,
   regexp_replace(array_join(concat(coalesce(cap,array()),coalesce(prc,array()),coalesce(eqp,array())),' | '),'(?i)\\b(dr|mr|mrs|ms)\\.?\\s+[a-z]+(\\s+[a-z]+)?','[name removed]') alltxt
  FROM fx)

, lq AS (SELECT unique_id, label, count(distinct fld) n_fields, max(int(fld<>'specialties')) svc_text,
    coalesce(max_by(regexp_replace(substr(x,1,140),'(?i)\\b(dr|mr|mrs|ms)\\.?\\s+[a-z]+(\\s+[a-z]+)?','[name removed]'), CASE WHEN fld='specialties' THEN 0 ELSE 1 END * 1000 - length(x)), '') quote
   FROM li GROUP BY 1,2),
lagg AS (SELECT unique_id,
    concat_ws(';', collect_list(concat(substr(label,1,3),':',n_fields,':',svc_text))) label_fields,
    concat_ws(' || ', collect_list(concat(substr(label,1,3),'::',replace(quote,'||','|')))) label_quotes,
    max(svc_text) has_service_text
   FROM lq GROUP BY 1)
SELECT l.unique_id, l.name,
  coalesce(l.ft,'unknown') facility_type,
  CASE WHEN l.op IN ('private') THEN 'private' WHEN l.op IN ('public','government') THEN 'public' ELSE 'unknown' END ownership,
  coalesce(l.city,'') city, coalesce(l.pstate, upper(trim(l.st_raw)), '') state, coalesce(l.pdist,'') district, coalesce(l.pin,'') pin,
  round(l.y,5) lat, round(l.x,5) lon, l.loc_approx,
  coalesce(g.label_fields,'') label_fields, coalesce(g.label_quotes,'') label_quotes,
  coalesce(g.has_service_text,0)=1 has_service_text,
  l.list_truncated, l.merge_suspect, l.n_merge_sig merge_signals, l.src_class source_class,
  (l.ft='clinic' OR l.docs<=2 OR l.beds<30) small_facility, l.single_specialty_name,
  CASE WHEN l.docs BETWEEN 1 AND 2000 THEN l.docs END doctors,
  CASE WHEN l.beds BETWEEN 1 AND 5000 THEN l.beds END beds,
  l.txt rlike 'emergency|casualty|trauma' emergency_claim,
  l.txt rlike '24/7|24x7|24 x 7|24 hours|24-hour|24 hrs|round the clock|round-the-clock' claims_247,
  l.txt rlike 'ambulance' ambulance,
  l.eqpt rlike 'ventilator|defibrillator|monitor' icu_equipment,
  coalesce(size(l.eqp),0)>0 equipment_listed,
  l.txt rlike '\\bicu\\b|iccu|\\bccu\\b|intensive care' icu_claim,
  l.eqpt rlike 'cath' cath_equipment,
  l.txt rlike 'obstetric|gyn|maternity|labou?r room|antenatal' has_obgyn,
  l.txt rlike '\\bnicu\\b|neonatal intensive' has_nicu,
  l.txt rlike 'dialysis|nephrolog' has_dialysis,
  l.txt rlike 'neurolog|stroke|thromboly' has_neuro_stroke,
  l.txt rlike 'diabet|endocrin' has_diabetes_care,
  l.txt rlike 'nabh' says_nabh,
  coalesce(regexp_extract(l.alltxt,'(?i)(.{0,60}(24/7|24x7|24 hours|round the clock|emergency|casualty).{0,60})',1),'') emergency_quote,
  coalesce(regexp_extract(l.alltxt,'(?i)(.{0,50}(\\bicu\\b|iccu|\\bccu\\b|intensive care).{0,50})',1),'') icu_quote,
  coalesce(regexp_extract(l.alltxt,'(?i)(.{0,40}(nabh).{0,40})',1),'') nabh_quote,
  CASE WHEN l.officialPhone IS NOT NULL AND lower(l.officialPhone) NOT IN ('null','') THEN l.officialPhone ELSE '' END official_phone,
  coalesce(p1.n_fac,0) official_phone_shared_by,
  coalesce(get(filter(transform(l.phs, z -> z), z -> substr(regexp_replace(z,'[^0-9]',''),-10) <> substr(regexp_replace(coalesce(l.officialPhone,''),'[^0-9]',''),-10)), 0),'') alt_phone,
  CASE WHEN l.officialWebsite IS NOT NULL AND lower(l.officialWebsite) NOT IN ('null','') THEN l.officialWebsite ELSE '' END website,
  coalesce(l.addr1,'') address
FROM loc l JOIN lagg g USING (unique_id)
LEFT JOIN phc p1 ON p1.n10 = substr(regexp_replace(coalesce(l.officialPhone,''),'[^0-9]',''),-10)
WHERE l.is_heart AND l.y BETWEEN :min_lat AND :max_lat AND l.x BETWEEN :min_lon AND :max_lon
ORDER BY pow(l.y-(:min_lat+:max_lat)/2,2)+pow(l.x-(:min_lon+:max_lon)/2,2)
LIMIT 400
