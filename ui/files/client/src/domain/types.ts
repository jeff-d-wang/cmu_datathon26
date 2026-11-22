// Row shape shared by the live candidates query (config/queries/candidates.sql)
// and the sample data. The 35 columns are the verified platinum-backed contract.
export interface Facility {
  unique_id: string;
  name: string;
  facility_class: string;
  ownership: string;
  city: string;
  state: string;
  district: string;
  pin: string;
  lat: number;
  lon: number;
  loc_approx: boolean;
  /** Compact per-service evidence map: "cardiology:high:3:0|dialysis:medium:1:2". Parsed by domain/services.ts. */
  services: string;
  /** Number of services with any evidence; number with band 'high'. */
  n_services: number;
  n_high: number;
  list_truncated: boolean;
  merge_suspect: boolean;
  merge_signals: number;
  source_class: string;
  small_facility: boolean;
  single_specialty_name: boolean;
  doctors: number | null;
  beds: number | null;
  claims_247: boolean;
  ambulance: boolean;
  icu_equipment: boolean;
  equipment_listed: boolean;
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
