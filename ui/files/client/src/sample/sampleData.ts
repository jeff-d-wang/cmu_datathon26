import type { Facility } from '../domain/types';

// SAMPLE DATA: fictional places for offline UI work. Not real facilities. Shown with a "Sample data" badge.
// services strings use the platinum compact format "key:band:channels:missing" (domain/services.ts
// parseServices); every key is a real 192-catalog service, so the sample path exercises the same
// code as live mode. n_services/n_high are hand-counted to match each services string.
const base: Omit<Facility, 'unique_id' | 'name' | 'lat' | 'lon'> = {
  facility_class: 'hospital', ownership: 'private', city: 'Karimnagar', state: 'TELANGANA', district: 'KARIMNAGAR', pin: '505001',
  loc_approx: false, services: '', n_services: 0, n_high: 0,
  list_truncated: false, merge_suspect: false, merge_signals: 0, source_class: 'non_directory', small_facility: false,
  single_specialty_name: false, doctors: null, beds: null, claims_247: false, ambulance: false,
  icu_equipment: false, equipment_listed: true, says_nabh: false, emergency_quote: '', icu_quote: '',
  nabh_quote: '', official_phone: '+91 00000 00001', official_phone_shared_by: 1, alt_phone: '', website: '', address: '[sample address]',
};

export const SAMPLE_FACILITIES: Facility[] = [
  { ...base, unique_id: 's-a', name: 'Example Heart Hospital A', lat: 18.5, lon: 79.2, beds: 120, doctors: 18,
    services: 'cardiology:high:3:0|echocardiography:high:2:0|diagnosticServices:medium:2:1|interventionalCardiology:high:2:0|cardiothoracicSurgery:high:3:0|icu:medium:1:1|emergencyCare:high:2:0',
    n_services: 7, n_high: 5, claims_247: true, says_nabh: true, nabh_quote: 'NABH accredited hospital',
    icu_quote: 'Coronary care unit (CCU) with 10 beds', emergency_quote: '24 hour emergency services', list_truncated: true },
  { ...base, unique_id: 's-b', name: 'Example Cardiac Centre B', lat: 18.7, lon: 79.0, ownership: 'public', beds: 300, doctors: 40,
    services: 'cardiology:high:3:0|interventionalCardiology:high:2:0|cardiothoracicSurgery:medium:2:1|pacemakerImplantation:high:2:0|icu:high:3:0|emergencyCare:high:3:0|dialysis:medium:1:2|neurology:high:2:0',
    n_services: 8, n_high: 6, claims_247: true, ambulance: true, icu_equipment: true,
    emergency_quote: 'Emergency and trauma care 24x7 with ambulance', official_phone_shared_by: 14 },
  { ...base, unique_id: 's-c', name: 'Example Heart Clinic C', lat: 18.44, lon: 79.13, facility_class: 'clinic', small_facility: true, doctors: 1,
    services: 'cardiology:medium:1:0|diagnosticServices:medium:1:0|ecgMachine:medium:1:0|echocardiography:unverified:1:0|endocrinologyAndDiabetesAndMetabolism:medium:1:1',
    n_services: 5, n_high: 0 },
  { ...base, unique_id: 's-d', name: 'Example Multispeciality Hospital D', lat: 18.3, lon: 79.4, ownership: 'unknown', loc_approx: true, beds: 60,
    services: 'cardiology:low:1:0|gynecologyAndObstetrics:unverified:1:0|nicu:unverified:1:0', n_services: 3, n_high: 0 },
  { ...base, unique_id: 's-e', name: 'Example Children’s Hospital E', lat: 17.9, lon: 79.6, beds: 80,
    services: 'pediatrics:high:3:0|pediatricCardiology:high:2:0|echocardiography:medium:2:0|gynecologyAndObstetrics:medium:1:1|nicu:medium:1:1',
    n_services: 5, n_high: 2 },
  { ...base, unique_id: 's-f', name: 'Example Medical College F', lat: 18.0, lon: 78.9, ownership: 'public', beds: 900, merge_suspect: true, merge_signals: 3,
    services: 'cardiothoracicSurgery:high:3:0|cardiology:high:2:0|dialysis:high:2:0|neurology:medium:2:1|icu:medium:1:1|emergencyCare:medium:1:2|physicalMedicineAndRehabilitation:medium:1:1',
    n_services: 7, n_high: 3, emergency_quote: 'Emergency and trauma care', icu_quote: 'Intensive care unit', list_truncated: true },
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
