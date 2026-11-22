import type { Facility } from '../domain/types';

// SAMPLE DATA: fictional places for offline UI work. Not real facilities. Shown with a "Sample data" badge.
const base: Omit<Facility, 'unique_id' | 'name' | 'lat' | 'lon'> = {
  facility_type: 'hospital', ownership: 'private', city: 'Karimnagar', state: 'TELANGANA', district: 'KARIMNAGAR', pin: '505001',
  loc_approx: false, label_fields: 'L01:2:1', label_quotes: 'L01::Offers cardiology consultations', has_service_text: true,
  list_truncated: false, merge_suspect: false, merge_signals: 0, source_class: 'non_directory', small_facility: false,
  single_specialty_name: false, doctors: null, beds: null, emergency_claim: false, claims_247: false, ambulance: false,
  icu_equipment: false, equipment_listed: true, icu_claim: false, cath_equipment: false, has_obgyn: false, has_nicu: false,
  has_dialysis: false, has_neuro_stroke: false, has_diabetes_care: false, says_nabh: false, emergency_quote: '', icu_quote: '',
  nabh_quote: '', official_phone: '+91 00000 00001', official_phone_shared_by: 1, alt_phone: '', website: '', address: '[sample address]',
};

export const SAMPLE_FACILITIES: Facility[] = [
  { ...base, unique_id: 's-a', name: 'Example Heart Hospital A', lat: 18.5, lon: 79.2, beds: 120, doctors: 18,
    label_fields: 'L07:3:1;L04:2:1;L05:2:1;L01:3:1;L03:2:1;L09:1:1', label_quotes: 'L07::Cardiac surgery || L04::Cath lab for angiography || L05::Performs coronary angioplasty || L01::Cardiology department || L03::2D Echo || L09::Coronary care unit (CCU)',
    emergency_claim: true, claims_247: true, icu_claim: true, has_obgyn: true, says_nabh: true, nabh_quote: 'NABH accredited hospital',
    cath_equipment: true, icu_quote: 'Coronary care unit (CCU) with 10 beds', emergency_quote: '24 hour emergency services', list_truncated: true },
  { ...base, unique_id: 's-b', name: 'Example Cardiac Centre B', lat: 18.7, lon: 79.0, ownership: 'public', beds: 300, doctors: 40,
    label_fields: 'L04:2:1;L05:2:1;L06:2:1;L08:1:1;L01:2:1;L09:2:1', label_quotes: 'L04::Coronary angiography || L05::Primary angioplasty || L06::Coronary artery bypass grafting (CABG) || L08::Pacemaker implantation || L09::ICCU',
    emergency_claim: true, claims_247: true, ambulance: true, icu_equipment: true, icu_claim: true, cath_equipment: true, has_dialysis: true, has_neuro_stroke: true,
    emergency_quote: 'Emergency and trauma care 24x7 with ambulance', official_phone_shared_by: 14 },
  { ...base, unique_id: 's-c', name: 'Example Heart Clinic C', lat: 18.44, lon: 79.13, facility_type: 'clinic', small_facility: true, doctors: 1,
    label_fields: 'L01:2:1;L02:2:1;L03:1:1;L05:1:1', label_quotes: 'L01::Cardiology consultation || L02::ECG and TMT || L03::Echocardiography || L05::Angioplasty', has_diabetes_care: true },
  { ...base, unique_id: 's-d', name: 'Example Multispeciality Hospital D', lat: 18.3, lon: 79.4, ownership: 'unknown', loc_approx: true,
    label_fields: 'L01:1:0', label_quotes: 'L01::cardiology', has_service_text: false, has_obgyn: true, has_nicu: true, beds: 60 },
  { ...base, unique_id: 's-e', name: 'Example Children’s Hospital E', lat: 17.9, lon: 79.6, beds: 80,
    label_fields: 'L11:2:1;L01:1:1;L03:2:1', label_quotes: 'L11::Pediatric cardiology services || L03::Fetal echocardiography', has_nicu: true, has_obgyn: true },
  { ...base, unique_id: 's-f', name: 'Example Medical College F', lat: 18.0, lon: 78.9, ownership: 'public', beds: 900, merge_suspect: true, merge_signals: 3,
    label_fields: 'L07:2:1;L06:1:1;L01:2:1;L10:1:1;L12:1:1', label_quotes: 'L07::Heart valve replacement || L06::Heart bypass surgery || L10::Heart failure clinic || L12::Cardiac rehabilitation',
    emergency_claim: true, icu_claim: true, icu_quote: 'Intensive care unit', has_dialysis: true, has_neuro_stroke: true, list_truncated: true },
];

export interface PlaceRow {
  kind: string;
  code: string;
  district: string;
  state: string;
  towns: string;
  lat: number;
  lon: number;
}

export const SAMPLE_STATES = ['MAHARASHTRA', 'TELANGANA'];
export const SAMPLE_PLACES: PlaceRow[] = [
  { kind: 'district', code: '', district: 'KARIMNAGAR', state: 'TELANGANA', towns: '', lat: 18.4386, lon: 79.1288 },
  { kind: 'district', code: '', district: 'HYDERABAD', state: 'TELANGANA', towns: '', lat: 17.385, lon: 78.4867 },
  { kind: 'pin', code: '505001', district: 'KARIMNAGAR', state: 'TELANGANA', towns: 'Karimnagar, Mukarampura', lat: 18.4386, lon: 79.1288 },
  { kind: 'pin', code: '500001', district: 'HYDERABAD', state: 'TELANGANA', towns: 'Hyderabad GPO, Abids', lat: 17.385, lon: 78.4867 },
  { kind: 'district', code: '', district: 'PUNE', state: 'MAHARASHTRA', towns: '', lat: 18.5204, lon: 73.8567 },
];
