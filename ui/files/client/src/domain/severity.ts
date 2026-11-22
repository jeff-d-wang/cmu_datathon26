import symptomMap from '../../../config/symptom_map.json';
import { isLabelCode, type LabelCode } from './labels';

/**
 * LAYER A (always on): clinician-reviewed rules. DRAFT: needs clinician review.
 * Severity tier, care level, plain-words treatment mapping and a cited guideline per symptom.
 * Red flags (redflags.ts) and the Emergency screen always come from Layer A and are never
 * overridden by Layer B.
 */
export type SeverityTier = 'EMERGENCY_NOW' | 'URGENT' | 'ROUTINE';
export const TIER_ORDER: Record<SeverityTier, number> = { ROUTINE: 1, URGENT: 2, EMERGENCY_NOW: 3 };
export const higherTier = (a: SeverityTier, b: SeverityTier): SeverityTier => (TIER_ORDER[b] > TIER_ORDER[a] ? b : a);

export type CareLevel = 'checkup_tests' | 'cath_lab' | 'heart_surgery' | 'rhythm_care' | 'childrens_heart' | 'emergency_department';

export interface Guideline {
  name: string;
  year: number;
  verify: string;
}

export interface SymptomRule {
  id: string;
  severity: SeverityTier;
  careLevels: CareLevel[];
  treatment: string;
  guideline: Guideline;
  warningSign: string;
}

const isTier = (v: string): v is SeverityTier => v === 'EMERGENCY_NOW' || v === 'URGENT' || v === 'ROUTINE';
const CARE_LEVELS: readonly string[] = Object.keys(symptomMap.care_levels);
const isCareLevel = (v: string): v is CareLevel => CARE_LEVELS.includes(v);

export const SYMPTOM_RULES: SymptomRule[] = symptomMap.symptoms.map((s) => ({
  id: s.id,
  severity: isTier(s.severity) ? s.severity : 'URGENT',
  careLevels: s.care_levels.filter(isCareLevel),
  treatment: s.treatment,
  guideline: s.guideline,
  warningSign: s.warning_sign,
}));

export const CARE_LEVEL_LABEL = (c: CareLevel): string => symptomMap.care_levels[c].label;
export const CARE_LEVEL_SERVICES = (c: CareLevel): LabelCode[] => symptomMap.care_levels[c].labels.filter(isLabelCode);
export const TIER_LABEL = (t: SeverityTier): string => symptomMap.severity_tiers[t].label;

export interface LayerAAssessment {
  tier: SeverityTier;
  careLevels: CareLevel[];
  treatments: { symptomId: string; text: string; guideline: Guideline; warningSign: string }[];
  /** True when red-flag rules fired: the Emergency screen is shown instead of any list. */
  redFlag: boolean;
}

export function assessLayerA(symptomIds: readonly string[], redFlag: boolean, mode: 'urgent' | 'planned', childUnder18 = false): LayerAAssessment {
  const rules = SYMPTOM_RULES.filter((r) => symptomIds.includes(r.id));
  let tier: SeverityTier = rules.reduce<SeverityTier>((t, r) => higherTier(t, r.severity), 'ROUTINE');
  if (redFlag) tier = 'EMERGENCY_NOW';
  const care = new Set<CareLevel>(rules.flatMap((r) => r.careLevels));
  if (mode === 'planned') symptomMap.planned_care_levels.filter(isCareLevel).forEach((c) => care.add(c));
  if (childUnder18) care.add('childrens_heart');
  if (tier === 'EMERGENCY_NOW' && isCareLevel(symptomMap.emergency_care_level)) care.add(symptomMap.emergency_care_level);
  if (care.size === 0) care.add('checkup_tests');
  return { tier, careLevels: [...care], treatments: rules.map((r) => ({ symptomId: r.id, text: r.treatment, guideline: r.guideline, warningSign: r.warningSign })), redFlag };
}
