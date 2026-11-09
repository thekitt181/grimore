/**
 * Sprites Chest 16 Animated Potions (itch.io) — personal End Product only.
 * License: use in your own games/projects; do not redistribute the sprites.
 * https://sazkuash.itch.io/potions-runes-pack-32x32-rpg-potions-runes
 */
import type { PropArt } from './propArt';

const T = '/props/sazkuash';

const POTIONS: Array<{ stem: string; name: string }> = [
  { stem: 'frost_potion', name: 'Frost' },
  { stem: 'blood_rage_potion', name: 'Blood Rage' },
  { stem: 'honey_potion', name: 'Honey' },
  { stem: 'nebula_potion', name: 'Nebula' },
  { stem: 'dragonfire_potion', name: 'Dragonfire' },
  { stem: 'bog_potion', name: 'Bog' },
  { stem: 'great_health_potion', name: 'Great Health' },
  { stem: 'rift_potion', name: 'Rift' },
  { stem: 'swift_potion', name: 'Swift' },
  { stem: 'moonwater_potion', name: 'Moonwater' },
  { stem: 'small_mana_potion', name: 'Small Mana' },
  { stem: 'venom_potion', name: 'Venom' },
  { stem: 'small_health_potion', name: 'Small Health' },
  { stem: 'great_mana_potion', name: 'Great Mana' },
  { stem: 'twin_bulb_potion', name: 'Twin Bulb' },
  { stem: 'shadow_potion', name: 'Shadow' },
];

function frames(stem: string): string[] {
  return Array.from({ length: 16 }, (_, i) => `${T}/${stem}/${String(i).padStart(2, '0')}.png`);
}

export const SAZKUASH_PROP_ART: PropArt[] = POTIONS.map(({ stem, name }) => {
  const rest = frames(stem);
  return {
    id: `saz-${stem.replace(/_potion$/, '').replace(/_/g, '-')}`,
    name: `${name} potion`,
    short: name,
    motion: 'loop',
    play: 'flicker',
    rest: rest[0]!,
    frames: rest,
  };
});

export const SAZKUASH_CREDIT =
  '16 Animated Potions by Sprites Chest (itch.io) · personal use, not redistributed';
