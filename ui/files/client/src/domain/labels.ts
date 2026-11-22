// DEPRECATED: the 12 heart-service labels (L01-L12) were replaced by the
// 192-service registry in domain/services.ts (config/service_registry.json).
// This file intentionally exports NOTHING: any import from it fails
// typecheck so the migration cannot silently miss a call site.
// Migration map: L01 cardiology | L02 echocardiography (tests: see catalog
// type 'diagnostic') | L03 echocardiography | L04/L05 interventionalCardiology
// | L06/L07 cardiothoracicSurgery | L08 cardiacElectrophysiologyPacing (see
// catalog) | L09 icu | L10 cardiology | L11 pediatricCardiology |
// L12 physicalMedicineAndRehabilitation.
// Kept as a stub (not deleted) until the whole client migration is verified.
export {};
