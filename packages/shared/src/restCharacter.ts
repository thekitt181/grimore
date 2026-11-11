import type { GrimoireCharacter, GrimoireFeature, GrimoireInventoryItem, GrimoireSpellSlots } from './types/ddb';

export type RestKind = 'short' | 'long';

function resetLabel(reset: string | undefined): string {
  return (reset ?? '').toLowerCase().replace(/[_-]+/g, ' ');
}

/** Long rest recovers short/long/dawn and unlabeled uses. Recharge (e.g. 5–6) stays. */
export function recoversOnRest(reset: string | undefined, kind: RestKind): boolean {
  const r = resetLabel(reset);
  if (/recharge/.test(r) && !/\b(short|long|dawn)\b/.test(r)) return false;
  if (kind === 'short') return /\bshort/.test(r);
  if (/dusk/.test(r) && !/\b(short|long|dawn)\b/.test(r)) return false;
  return true;
}

function resetUses<T extends Pick<GrimoireFeature, 'usesMax' | 'usesUsed' | 'usesRemaining' | 'usesReset'>>(
  entry: T,
  kind: RestKind,
): T {
  const max = entry.usesMax ?? 0;
  const used = entry.usesUsed ?? 0;
  const remaining = entry.usesRemaining;
  if (max <= 0 && used <= 0 && remaining == null) return entry;
  if (!recoversOnRest(entry.usesReset, kind)) return entry;
  const restored = max > 0 ? max : (remaining ?? 0) + used;
  if (restored <= 0) return entry;
  return { ...entry, usesUsed: 0, usesRemaining: restored, ...(max > 0 ? {} : { usesMax: restored }) };
}

function resetSlots(slots: GrimoireSpellSlots[], kind: RestKind, classes: string[]): GrimoireSpellSlots[] {
  if (kind === 'long') {
    return slots.map((s) => ({ ...s, used: 0 }));
  }
  const warlock = classes.some((c) => /warlock/i.test(c));
  if (!warlock) return slots;
  return slots.map((s) => ({ ...s, used: 0 }));
}

/** Apply a short or long rest to a cached character (slots, features, item charges). */
export function applyRestToCharacter(character: GrimoireCharacter, kind: RestKind): GrimoireCharacter {
  const features = (character.features ?? []).map((f) => resetUses(f, kind));
  const feats = (character.feats ?? []).map((f) => resetUses(f, kind));
  const inventory = (character.inventory ?? []).map((i) => resetUses(i, kind) as GrimoireInventoryItem);
  const spellSlots = resetSlots(character.spellSlots ?? [], kind, character.classes ?? []);
  const next: GrimoireCharacter = {
    ...character,
    features,
    feats,
    inventory,
    spellSlots,
  };
  if (kind === 'long') {
    next.hp = character.maxHp;
    next.tempHp = 0;
    next.deathSaves = { successes: 0, failures: 0, stabilized: false };
  }
  return next;
}
