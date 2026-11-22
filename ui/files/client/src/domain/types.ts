// Row shape shared by the live heart_candidates query and the sample data.
export interface Facility {
  unique_id: string;
  name: string;
  facility_type: string;
  ownership: string;
  city: string;
  state: string;
  district: string;
  pin: string;
  lat: number;
  lon: number;
  loc_approx: boolean;
  label_fields: string;
  label_quotes: string;
  has_service_text: boolean;
  list_truncated: boolean;
  merge_suspect: boolean;
  merge_signals: number;
  source_class: string;
  small_facility: boolean;
  single_specialty_name: boolean;
  doctors: number | null;
  beds: number | null;
  emergency_claim: boolean;
  claims_247: boolean;
  ambulance: boolean;
  icu_equipment: boolean;
  equipment_listed: boolean;
  icu_claim: boolean;
  cath_equipment: boolean;
  has_obgyn: boolean;
  has_nicu: boolean;
  has_dialysis: boolean;
  has_neuro_stroke: boolean;
  has_diabetes_care: boolean;
  says_nabh: boolean;
  emergency_quote: string;
  icu_quote: string;
  nabh_quote: string;
  official_phone: string;
  official_phone_shared_by: number;
  alt_phone: string;
  website: string;
  address: string;
}

export interface Conditions {
  pregnant: boolean;
  kidney: boolean;
  stroke: boolean;
  diabetes: boolean;
}

export type Mode = 'urgent' | 'planned';
