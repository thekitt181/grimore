/**
 * assets2D free chests (itch.io) — personal End Product only.
 * Use in your games; do not redistribute the sprites.
 * https://assets2d.itch.io/treasure-chest
 * https://assets2d.itch.io/chest2
 * https://assets2d.itch.io/chests-3
 */
import type { PropArt } from './propArt';

const T = '/props/assets2d';

type Sheet = {
  id: string;
  stem: string;
  name: string;
  short: string;
  total: number;
  /** Closed idle frames (0 .. idle-1). Remainder is the open cycle. */
  idle: number;
};

export const ASSETS2D_CHEST_SHEETS: Sheet[] = [
  { id: 'a2d-octopus', stem: 'octopus', name: 'Octopus chest', short: 'Octopus', total: 46, idle: 27 },
  { id: 'a2d-purple', stem: 'purple', name: 'Cursed chest', short: 'Cursed', total: 41, idle: 21 },
  { id: 'a2d-spring', stem: 'chest4', name: 'Spring chest', short: 'Spring', total: 45, idle: 37 },
];

function frameUrls(stem: string, total: number): string[] {
  return Array.from({ length: total }, (_, i) => `${T}/${stem}/${String(i).padStart(2, '0')}.png`);
}

export const ASSETS2D_CHEST_ART: PropArt[] = ASSETS2D_CHEST_SHEETS.map((s) => {
  const frames = frameUrls(s.stem, s.total);
  return {
    id: s.id,
    name: s.name,
    short: s.short,
    motion: 'toggle',
    play: 'lift',
    rest: frames[0]!,
    open: frames[frames.length - 1],
    frames,
  };
});

export const ASSETS2D_CHEST_IDLE: Record<string, number> = Object.fromEntries(
  ASSETS2D_CHEST_SHEETS.map((s) => [s.id, s.idle]),
);

export const ASSETS2D_CREDIT =
  'Free chests by assets2D (itch.io) · personal use, not redistributed. Premium packs need the paid zips dropped in Downloads.';
