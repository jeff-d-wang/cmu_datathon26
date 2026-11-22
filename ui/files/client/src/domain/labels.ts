// The 12 plain-language heart service labels (from findings/label_map.csv and sql/heart/hb.sql).
export const LABEL_CODES = ['L01', 'L02', 'L03', 'L04', 'L05', 'L06', 'L07', 'L08', 'L09', 'L10', 'L11', 'L12'] as const;
export type LabelCode = (typeof LABEL_CODES)[number];

export const CATH_LAB_LABELS: readonly LabelCode[] = ['L04', 'L05'];
export const SURGERY_LABELS: readonly LabelCode[] = ['L06', 'L07'];
export const LARGE_PROCEDURE_LABELS: readonly LabelCode[] = ['L05', 'L06', 'L07'];

/** Service filter chips shown on the results screen. */
export const FILTER_LABELS: readonly LabelCode[] = ['L04', 'L05', 'L06', 'L08', 'L11'];

export function isLabelCode(value: string): value is LabelCode {
  return (LABEL_CODES as readonly string[]).includes(value);
}

/** "L07:2;L01:1" -> Map { L07 => 2, L01 => 1 } (number of independent fields that mention the label). */
export function parseLabelFields(raw: string): Map<LabelCode, number> {
  const out = new Map<LabelCode, number>();
  for (const part of raw.split(';')) {
    const [code, n] = part.split(':');
    if (code && isLabelCode(code)) out.set(code, Number(n) || 1); // optional 3rd part (text flag) is ignored here
  }
  return out;
}

/** "L07::Cardiac surgery || L01::cardiology" -> Map { L07 => "Cardiac surgery", ... } */
export function parseLabelQuotes(raw: string): Map<LabelCode, string> {
  const out = new Map<LabelCode, string>();
  for (const part of raw.split(' || ')) {
    const idx = part.indexOf('::');
    if (idx < 0) continue;
    const code = part.slice(0, idx);
    if (isLabelCode(code)) out.set(code, part.slice(idx + 2));
  }
  return out;
}

export interface LabelEvidence {
  /** Number of independent fields (capability, procedure, equipment, specialties) that mention the label (1-4). */
  fields: number;
  /** True when at least one mention is in service TEXT (not only a specialty tag). */
  text: boolean;
}

/** "L05:2:1;L01:1:0" -> Map { L05 => {fields: 2, text: true}, L01 => {fields: 1, text: false} } */
export function parseLabelEvidence(raw: string): Map<LabelCode, LabelEvidence> {
  const out = new Map<LabelCode, LabelEvidence>();
  for (const part of raw.split(';')) {
    const [code, n, t] = part.split(':');
    if (code && isLabelCode(code)) out.set(code, { fields: Number(n) || 1, text: t === undefined ? true : t === '1' });
  }
  return out;
}
