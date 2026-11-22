import type { EngineFacility } from './method';
import { clean, isPresent } from './present';

const SEP = '\u001f';
const str = (v: unknown): string => (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? (clean(v) ?? '') : '');
const num = (v: unknown): number | null => (!isPresent(v) || Number.isNaN(Number(v)) ? null : Number(v));
const list = (v: unknown): string[] => str(v).split(SEP).filter(isPresent);

/** One engine_candidates_clean row (JSON values can arrive as strings) -> EngineFacility. */
export function toEngineFacility(r: Record<string, unknown>): EngineFacility {
  return {
    id: str(r.id), name: str(r.name), city: str(r.city), state: str(r.state), pin: str(r.pin), facility_type: str(r.facility_type),
    capacity: num(r.capacity), lat: Number(r.lat), lon: Number(r.lon), centroid_lat: num(r.centroid_lat), centroid_lon: num(r.centroid_lon),
    pincode_matched: r.pincode_matched === true || r.pincode_matched === 'true', phone: str(r.phone), website: str(r.website),
    specialties: list(r.specialties), procedure: list(r.procedure), equipment: list(r.equipment), capability: list(r.capability), description: str(r.description),
  };
}
