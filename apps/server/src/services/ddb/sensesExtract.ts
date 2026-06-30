/* eslint-disable @typescript-eslint/no-explicit-any */
import { collectModifiers } from './attackExtract';

/** D&D Beyond sense id for darkvision in customSenses. */
const DDB_DARKVISION_SENSE_ID = 2;

function parseFeetFromText(text: string): number | null {
  const m = String(text).match(/(\d+)\s*ft/i);
  return m ? Number(m[1]) : null;
}

function darkvisionFromModifier(mod: any): number | null {
  const sub = String(mod.subType ?? '').toLowerCase();
  if (sub !== 'darkvision') return null;

  const type = String(mod.type ?? '').toLowerCase();
  if (type === 'set-base' || type === 'bonus') {
    const v = mod.fixedValue ?? mod.value;
    if (typeof v === 'number' && v > 0) return v;
  }
  if (type === 'sense') {
    return parseFeetFromText(mod.restriction ?? '')
      ?? (typeof mod.fixedValue === 'number' && mod.fixedValue > 0 ? mod.fixedValue : null);
  }
  return null;
}

/** Darkvision range in feet; 0 when the character has no darkvision. */
export function extractDarkvisionFt(raw: any): number {
  let max = 0;

  for (const sense of raw.customSenses ?? []) {
    if (Number(sense.senseId) !== DDB_DARKVISION_SENSE_ID) continue;
    const dist = Number(sense.distance);
    if (Number.isFinite(dist) && dist > max) max = dist;
  }

  for (const mod of collectModifiers(raw)) {
    const ft = darkvisionFromModifier(mod);
    if (ft != null && ft > max) max = ft;
  }

  return max;
}
