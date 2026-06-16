import type { CompendiumSpell } from '@grimoire/shared';

function normalizeSpellName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[''']/g, '')
    .replace(/\s+/g, ' ');
}

/** Best compendium row for a JB2A / effects catalog spell name. */
export function findCompendiumSpellMatch(
  spellName: string,
  items: CompendiumSpell[],
): CompendiumSpell | undefined {
  if (items.length === 0) return undefined;

  const target = normalizeSpellName(spellName);
  const exact = items.find((s) => normalizeSpellName(s.name) === target);
  if (exact) return exact;

  const starts = items.filter((s) => normalizeSpellName(s.name).startsWith(target));
  if (starts.length === 1) return starts[0];

  const contains = items.filter((s) => normalizeSpellName(s.name).includes(target));
  if (contains.length === 1) return contains[0];

  return undefined;
}
