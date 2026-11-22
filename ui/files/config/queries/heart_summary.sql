-- Count of heart facilities in the data (shown on onboarding). READ-ONLY.
WITH f0 AS (
 SELECT unique_id, name, facilityTypeId ft, operatorTypeId op, address_city city, replace(trim(address_zipOrPostcode),' ','') pin,
  latitude la, longitude lo, officialWebsite, recency_of_page_update rec, post_metrics_most_recent_social_media_post_date spd,
  from_json(capability,'array<string>') cap, from_json(procedure,'array<string>') prc, from_json(equipment,'array<string>') eqp,
  lower(coalesce(specialties,'')) spec, lower(coalesce(description,'')) dsc,
  from_json(source_urls,'array<string>') urls, from_json(phone_numbers,'array<string>') phs, from_json(source_ids,'array<string>') sids,
  try_cast(numberDoctors as int) docs, affiliationTypeIds aff, email, websites, officialPhone, address_line1 addr1, facebookLink fb, address_stateOrRegion st_raw, description desc_raw, try_cast(capacity as int) beds, try_cast(yearEstablished as int) yr,
  regexp_extract(lower(officialWebsite),'^(https?://)?(www\\.)?([^/]+)',3) ow
 FROM databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.facilities WHERE address_country='India'),
f1 AS (SELECT *, lower(array_join(coalesce(cap,array()),' | ')) capt, lower(array_join(coalesce(prc,array()),' | ')) prct, lower(array_join(coalesce(eqp,array()),' | ')) eqpt,
  (coalesce(size(cap),0)=50 OR coalesce(size(prc),0)=50 OR coalesce(size(eqp),0)=50) list_truncated,
  coalesce(size(cap),0)+coalesce(size(prc),0)+coalesce(size(eqp),0) n_claims FROM f0),
dom AS (SELECT unique_id, regexp_extract(lower(x),'^https?://(www\\.)?([^/]+)',2) d FROM f0 LATERAL VIEW explode(urls) e AS x WHERE x rlike '^https?'),
domc AS (SELECT unique_id, d, CASE WHEN d rlike 'practo|justdial|medindia|onefivenine|proptiger|hexahealth|mappls|docindia|policyx|lybrate|indiamart|latlong|medicineindia|healthfrog|sulekha|credihealth|lbb|tripadvisor|google|yellowpages|mouthshut|nearbuy|bajajfinserv|zocdoc|1mg|pharmeasy' THEN 'dir' WHEN d rlike 'facebook|linkedin|instagram|twitter|youtube|x\\.com' THEN 'soc' WHEN d rlike '\\.gov\\.in|\\.nic\\.in|\\.edu|\\.ac\\.in|who\\.int|icmr|mohfw' THEN 'gov' WHEN d rlike 'insur|policy|star ?health|hdfc|icici|lic\\.|healthindia|medi ?assist|paramount|mdindia' THEN 'ins' ELSE 'own' END cls FROM dom),
src AS (SELECT unique_id, count(distinct case when cls='own' then d end) n_own, max(int(cls='own')) has_own, max(int(cls='gov')) has_gov, max(int(cls in ('dir','soc','ins'))) has_dir FROM domc GROUP BY 1),
pc AS (SELECT cast(pincode as string) pin, avg(try_cast(latitude as double)) pla, avg(try_cast(longitude as double)) plo, max(upper(trim(statename))) pstate, max(upper(trim(district))) pdist, count(distinct upper(trim(district))) pnd
 FROM databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.india_post_pincode_directory
 WHERE try_cast(latitude as double) between 6 and 37.6 AND try_cast(longitude as double) between 68 and 97.5 GROUP BY 1),
g AS (SELECT f1.*, coalesce(src.n_own,0) n_own, coalesce(src.has_own,0) has_own, coalesce(src.has_gov,0) has_gov, coalesce(src.has_dir,0) has_dir,
  CASE WHEN src.has_own=1 THEN 'non_directory' WHEN src.has_gov=1 THEN 'gov' WHEN src.has_dir=1 THEN 'directory_only' ELSE 'none' END src_class,
  coalesce(size(array_distinct(transform(phs, x -> substr(regexp_replace(x,'[^0-9]',''),-10)))),0) n_ph,
  coalesce(size(array_distinct(sids)),0) n_sid, pc.pstate, pc.pdist, pc.pnd, pc.pla, pc.plo,
  CASE WHEN pc.pla IS NOT NULL AND f1.la IS NOT NULL THEN 2*6371*asin(sqrt(pow(sin(radians(f1.la-pc.pla)/2),2)+cos(radians(pc.pla))*cos(radians(f1.la))*pow(sin(radians(f1.lo-pc.plo)/2),2))) END km_pin,
  coalesce(lower(name) rlike 'hospital.*( and |&|/|,).*(hospital|clinic|nursing home)',false) name2
 FROM f1 LEFT JOIN src USING (unique_id) LEFT JOIN pc ON f1.pin=pc.pin),
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

SELECT count(*) heart_facilities, sum(int(cathlab)) cathlab_level, sum(int(surgery)) surgery_level FROM hf
