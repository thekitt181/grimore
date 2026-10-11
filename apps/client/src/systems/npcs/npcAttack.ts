import type { ParsedAction } from '@/systems/compendium/statBlockParser';

const ATTACK = /([A-Za-z][A-Za-z'’ -]{0,40}?)\s+\+(\d+)\s*,\s*(\d+d\d+(?:\s*[+-]\s*\d+)?)\s+([a-z]+)/gi;
const RANGED = /\b(bow|crossbow|sling|javelin|dart)\b/i;

/** Turn "Hammer +4, 1d8+2 bludgeoning" into a rollable token attack. */
export function parseNpcAttacks(text: string): ParsedAction[] {
  const actions: ParsedAction[] = [];
  for (const match of text.matchAll(ATTACK)) {
    const name = cleanName(match[1] ?? '');
    const dice = (match[3] ?? '').replace(/\s+/g, '');
    const type = (match[4] ?? '').toLowerCase();
    const toHit = Number(match[2]);
    if (!name || !dice || Number.isNaN(toHit)) continue;
    const ranged = RANGED.test(name);
    actions.push({
      name,
      originalText: (match[0] ?? name).trim(),
      section: 'actions',
      isTrait: false,
      toHit,
      damages: [{ dice, type }],
      spells: [],
      range: ranged
        ? { kind: 'ranged', reachFt: 5, rangeNormalFt: 80, rangeLongFt: 320 }
        : { kind: 'melee', reachFt: 5 },
    });
  }
  return actions;
}

function cleanName(raw: string): string {
  const trimmed = raw
    .replace(/^[,.\s]+/, '')
    .replace(/^(?:then|or|and)\s+/i, '')
    .replace(/^(?:a|an|the)\s+/i, '')
    .trim();
  if (!trimmed) return '';
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}
