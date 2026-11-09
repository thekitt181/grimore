import { v4 as uuidv4 } from 'uuid';
import { monsterSizeToCells, parseCr, parseSizeFromType } from '@grimoire/monster-dex';
import type { CompendiumMonster } from '@grimoire/shared';
import { searchMonsters } from '@/systems/compendium/compendiumApi';
import { summonMonster } from '@/systems/compendium/summonMonster';
import { partyLevelFromTokens, partySizeFromTokens } from '@/systems/combat/partyLevel';
import type { MapItem } from '@/systems/scene/types';
import { themeKeywords, type DungeonMotif, type GeneratedDungeon } from './generateDungeon';
import { MODULAR_PX_PER_UNIT, MODULAR_ROOM_WALL_CELLS } from '@/systems/map/library/modularKits';
import { mapLocalToWorld as mapLocalPointToWorld } from '@/systems/map/wallUtils';
import type { ModularFurnishRoom } from './dungeonPropSpawn';

type Difficulty = 'skip' | 'easy' | 'medium' | 'hard' | 'deadly';

const XP_BY_CR: Array<[number, number]> = [
  [0, 10], [0.125, 25], [0.25, 50], [0.5, 100], [1, 200], [2, 450], [3, 700],
  [4, 1100], [5, 1800], [6, 2300], [7, 2900], [8, 3900], [9, 5000], [10, 5900],
  [11, 7200], [12, 8400], [13, 10000], [14, 11500], [15, 13000], [16, 15000],
  [17, 18000], [18, 20000], [19, 22000], [20, 25000], [21, 33000], [22, 41000],
  [23, 50000], [24, 62000], [25, 75000], [30, 155000],
];

/** Per-character XP thresholds (5e). */
const THRESHOLD: Record<number, Record<Exclude<Difficulty, 'skip'>, number>> = {
  1: { easy: 25, medium: 50, hard: 75, deadly: 100 },
  2: { easy: 50, medium: 100, hard: 150, deadly: 200 },
  3: { easy: 75, medium: 150, hard: 225, deadly: 400 },
  4: { easy: 125, medium: 250, hard: 375, deadly: 500 },
  5: { easy: 250, medium: 500, hard: 750, deadly: 1100 },
  6: { easy: 300, medium: 600, hard: 900, deadly: 1400 },
  7: { easy: 350, medium: 750, hard: 1100, deadly: 1700 },
  8: { easy: 450, medium: 900, hard: 1400, deadly: 2100 },
  9: { easy: 550, medium: 1100, hard: 1600, deadly: 2400 },
  10: { easy: 600, medium: 1200, hard: 1900, deadly: 2800 },
  11: { easy: 800, medium: 1600, hard: 2400, deadly: 3600 },
  12: { easy: 1000, medium: 2000, hard: 3000, deadly: 4500 },
  13: { easy: 1100, medium: 2200, hard: 3400, deadly: 5100 },
  14: { easy: 1250, medium: 2500, hard: 3800, deadly: 5700 },
  15: { easy: 1400, medium: 2800, hard: 4300, deadly: 6400 },
  16: { easy: 1600, medium: 3200, hard: 4800, deadly: 7200 },
  17: { easy: 2000, medium: 3900, hard: 5900, deadly: 8800 },
  18: { easy: 2100, medium: 4200, hard: 6300, deadly: 9500 },
  19: { easy: 2400, medium: 4900, hard: 7300, deadly: 10900 },
  20: { easy: 2800, medium: 5700, hard: 8500, deadly: 12700 },
};

const MOTIF_KEYS: Record<DungeonMotif, string[]> = {
  crypt: [
    'undead', 'skeleton', 'zombie', 'ghoul', 'wight', 'ghost', 'shadow', 'mummy',
    'specter', 'spectre', 'vampire', 'wraith', 'lich', 'death knight', 'banshee',
    'crawling claw', 'bone', 'ghast', 'revenant',
  ],
  temple: [
    'cultist', 'priest', 'acolyte', 'fanatic', 'gargoyle', 'celestial', 'fiend',
    'demon', 'devil', 'angel', 'golem', 'animated', 'knight', 'cult', 'imp',
    'quasit', 'helmed horror', 'statue',
  ],
  fortress: [
    'guard', 'veteran', 'hobgoblin', 'orc', 'goblin',
    'bandit', 'ogre', 'bugbear', 'captain', 'soldier', 'thug', 'scout',
    'hobgoblin captain', 'orc war chief',
  ],
  mine: [
    'kobold', 'duergar', 'grimlock', 'umber hulk', 'piercer', 'roper', 'darkmantle',
    'xorn', 'troglodyte', 'myconid', 'underdark', 'galeb', 'hook horror',
  ],
  ruin: [
    'ooze', 'spider', 'stirge', 'mimic', 'rust monster', 'gelatinous',
    'pudding', 'ettercap', 'ankheg', 'vine', 'blight', 'shambling', 'will-o',
    'mephit', 'gargoyle',
  ],
  mixed: [
    'undead', 'goblin', 'orc', 'bandit', 'spider', 'stirge', 'ooze', 'cultist',
    'kobold', 'skeleton', 'guard', 'beast',
  ],
};

const ROOM_KEYS: Array<{ test: RegExp; keys: string[] }> = [
  { test: /ossuary|burial|tomb|sarcophag|embalm|niche|grave|crypt|bone/i, keys: ['undead', 'skeleton', 'zombie', 'ghoul', 'wight'] },
  { test: /shrine|nave|reliquary|choir|vestry|priest|font|offering|penitent/i, keys: ['cultist', 'priest', 'acolyte', 'gargoyle', 'animated'] },
  { test: /barracks|guard|gatehouse|armory|watch|mess|cell block|prison/i, keys: ['guard', 'veteran', 'hobgoblin', 'orc', 'bandit', 'thug'] },
  { test: /ore|cart dock|foreman|shaft|lift|assay|mine|quarry/i, keys: ['kobold', 'duergar', 'darkmantle', 'piercer', 'xorn'] },
  { test: /library|archive|scriptory|study|laboratory/i, keys: ['nothic', 'mephit', 'homunculus', 'golem', 'imp', 'animated'] },
  { test: /kitchen|dining|storeroom|store niche/i, keys: ['rat', 'stirge', 'spider', 'kobold'] },
  { test: /well|pool|pump|flood/i, keys: ['ooze', 'water elemental', 'stirge', 'darkmantle'] },
  { test: /collapsed|rubble|ruin|garden/i, keys: ['spider', 'blight', 'stirge', 'ooze'] },
  { test: /conflict|guardian|whispering shadow|kneeling figure that is not stone/i, keys: ['wight', 'champion', 'knight', 'golem', 'ogre', 'captain'] },
];

function xpForCr(cr: number): number {
  let best = XP_BY_CR[0]![1];
  for (const [band, xp] of XP_BY_CR) {
    if (cr >= band) best = xp;
  }
  return best;
}

function encounterMultiplier(count: number): number {
  if (count <= 1) return 1;
  if (count === 2) return 1.5;
  if (count <= 6) return 2;
  if (count <= 10) return 2.5;
  if (count <= 14) return 3;
  return 4;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function blobOf(m: CompendiumMonster): string {
  return `${m.name} ${m.type ?? ''} ${m.description ?? ''}`.toLowerCase();
}

/** Phrase packs so a written theme pulls the right ecology, not a CR-matched stranger. */
const LORE_PACKS: Array<{ test: RegExp; add: string[]; ban: RegExp }> = [
  {
    test: /under\s*-?\s*dark|drow|duergar|myconid|illithid|mind flayer|kuo-?toa/i,
    add: [
      'drow', 'duergar', 'myconid', 'grimlock', 'umber hulk', 'hook horror', 'quaggoth',
      'derro', 'roper', 'piercer', 'darkmantle', 'kuo-toa', 'mind flayer', 'illithid',
      'beholder', 'troglodyte', 'cloaker', 'nothic', 'drider', 'svirfneblin', 'deep gnome',
      'otyugh', 'cave fisher', 'carrion crawler', 'underdark',
    ],
    ban: /\bastral elf\b|\beladrin\b|\bhigh elf\b|\bwood elf\b|\bsea elf\b|\bastral\b|\bcelestial\b|\bangel\b|\bsolar\b|\bplanetar\b|\baarakocra\b|\bgithyanki\b|\bpegasus\b|\bgriffon\b|\bhippogriff\b/i,
  },
  {
    test: /\bcrypt\b|\bundead\b|\btomb\b|\bbarrow\b|\bossuary\b|\bcatacomb/i,
    add: ['undead', 'skeleton', 'zombie', 'ghoul', 'wight', 'ghost', 'shadow', 'mummy', 'specter', 'wraith', 'ghast', 'revenant', 'banshee'],
    ban: /\bastral elf\b|\bcelestial\b|\bangel\b|\bsolar\b|\bfey\b|\beladrin\b|\baarakocra\b/i,
  },
  {
    test: /\bfortress\b|\bbarracks\b|\bkeep\b|\bwarband\b|\bsoldier/i,
    add: ['guard', 'veteran', 'hobgoblin', 'orc', 'goblin', 'bandit', 'ogre', 'bugbear', 'captain', 'soldier', 'thug'],
    ban: /\bastral\b|\bcelestial\b|\bmyconid\b|\bgelatinous\b|\booze\b/i,
  },
  {
    test: /\btemple\b|\bcult\b|\bshrine\b|\baltar\b|\bpriest/i,
    add: ['cultist', 'priest', 'acolyte', 'fanatic', 'gargoyle', 'imp', 'quasit', 'helmed horror', 'animated'],
    ban: /\bastral elf\b|\bmyconid\b|\bumber hulk\b/i,
  },
];

function loreFor(theme: string, motif: DungeonMotif, room: string): { prefer: string[]; extra: string[]; bans: RegExp[] } {
  const blob = `${theme}\n${room}`;
  const prefer = [...themeKeywords(theme)];
  const extra = [...MOTIF_KEYS[motif]];
  const bans: RegExp[] = [];
  for (const pack of LORE_PACKS) {
    if (!pack.test.test(blob) && !pack.test.test(theme)) continue;
    for (const key of pack.add) {
      if (!prefer.includes(key)) prefer.push(key);
    }
    bans.push(pack.ban);
  }
  return { prefer, extra, bans };
}

function hitScore(m: CompendiumMonster, keys: string[]): number {
  const name = m.name.toLowerCase();
  const type = (m.type ?? '').toLowerCase();
  const blob = blobOf(m);
  let score = 0;
  for (const key of keys) {
    const k = key.toLowerCase();
    if (k.length < 3) continue;
    if (name.includes(k)) score += 6;
    else if (type.includes(k)) score += 4;
    else if (blob.includes(k)) score += 1;
  }
  return score;
}

function scoreMonster(
  m: CompendiumMonster,
  prefer: string[],
  extra: string[],
  bans: RegExp[],
  crMin: number,
  crMax: number,
  deadly: boolean,
  partyLevel: number,
): number {
  const cr = parseCr(m.cr);
  if (cr < crMin || cr > crMax) return -1;
  const blob = blobOf(m);
  const name = m.name.toLowerCase();
  if (/\b(legendary|lair actions)\b/.test(blob) && !deadly) return -1;
  if (/\bdragon\b/.test(blob) && !(deadly && partyLevel >= 8)) return -1;
  if (/^the /i.test(m.name) && !deadly) return -1;
  if (bans.some((ban) => ban.test(name) || ban.test(blob))) return -1;
  const lore = hitScore(m, prefer) * 2 + hitScore(m, extra);
  if (prefer.length > 0 && hitScore(m, prefer) < 4) return -1;
  if (prefer.length === 0 && lore < 4) return -1;
  const mid = (crMin + crMax) / 2;
  return lore + (2 - Math.min(2, Math.abs(cr - mid)));
}

function roomText(title: string, notes: string[]): string {
  return `${title}\n${notes.join('\n')}`;
}

function difficultyFor(title: string, notes: string[], index: number, total: number, rnd: () => number): Difficulty {
  const text = roomText(title, notes);
  if (/^stairs$/i.test(title)) return rnd() < 0.35 ? 'easy' : 'skip';
  if (/puzzle/i.test(title)) return rnd() < 0.3 ? 'easy' : 'skip';
  if (/reward/i.test(title)) return rnd() < 0.35 ? 'medium' : 'skip';
  if (/conflict/i.test(title) || /guardian|whispering shadow|kneeling figure that is not stone/i.test(text)) {
    return 'deadly';
  }
  if (/sealed tomb|ossuary|gatehouse|watch loft/i.test(title)) return 'hard';
  if (/entrance/i.test(title)) return 'easy';
  if (/storeroom|kitchen|infirmary|dining|well chamber/i.test(title)) {
    return rnd() < 0.45 ? 'easy' : 'skip';
  }
  if (index === total - 1 && !/reward|entrance/i.test(title)) return 'hard';
  if (rnd() < 0.22) return 'skip';
  return rnd() < 0.35 ? 'easy' : 'medium';
}

function loreForRoom(motif: DungeonMotif, title: string, notes: string[], theme?: string) {
  const text = `${theme ?? ''}\n${roomText(title, notes)}`;
  const lore = loreFor(theme ?? '', motif, text);
  for (const rule of ROOM_KEYS) {
    if (rule.test.test(text)) {
      for (const key of rule.keys) {
        if (!lore.extra.includes(key)) lore.extra.push(key);
      }
    }
  }
  return lore;
}

function crWindow(level: number, diff: Exclude<Difficulty, 'skip'>): { min: number; max: number } {
  if (diff === 'easy') return { min: 0, max: Math.max(0.25, level * 0.5) };
  if (diff === 'medium') return { min: 0, max: Math.max(1, level * 0.75) };
  if (diff === 'hard') return { min: Math.max(0.25, level * 0.35), max: level + 1 };
  return { min: Math.max(0.5, level * 0.6), max: level + 4 };
}

function pickCount(monster: CompendiumMonster, budget: number, maxSlots: number, deadly: boolean): number {
  const xp = xpForCr(parseCr(monster.cr));
  if (xp <= 0) return 1;
  let best = 1;
  const cap = deadly ? Math.min(3, maxSlots) : Math.min(6, maxSlots);
  for (let n = 1; n <= cap; n++) {
    if (xp * n * encounterMultiplier(n) <= budget * 1.2) best = n;
  }
  return best;
}

async function loadPool(crMin: number, crMax: number): Promise<CompendiumMonster[]> {
  const all: CompendiumMonster[] = [];
  for (let page = 1; page <= 5; page++) {
    const res = await searchMonsters({ crMin, crMax, page, limit: 100 });
    all.push(...res.items);
    if (all.length >= res.total || res.items.length === 0) break;
  }
  return all;
}

function pickFromPool(
  pool: CompendiumMonster[],
  lore: { prefer: string[]; extra: string[]; bans: RegExp[] },
  crMin: number,
  crMax: number,
  deadly: boolean,
  partyLevel: number,
  rnd: () => number,
  usedNames: Set<string>,
): CompendiumMonster | null {
  const ranked = pool
    .map((m) => ({
      m,
      s: scoreMonster(m, lore.prefer, lore.extra, lore.bans, crMin, crMax, deadly, partyLevel),
    }))
    .filter((r) => r.s >= 4)
    .sort((a, b) => b.s - a.s);
  const fresh = ranked.filter((r) => !usedNames.has(r.m.name.toLowerCase()));
  const list = fresh.length > 0 ? fresh : ranked;
  if (list.length === 0) return null;
  const top = list.slice(0, Math.min(6, list.length));
  return top[Math.floor(rnd() * top.length)]!.m;
}

export type DungeonMonsterSpawnOpts = {
  partyLevel?: number;
  theme?: string;
};

function tokenCellsFor(monster: CompendiumMonster): number {
  return Math.max(1, Math.round(monsterSizeToCells(parseSizeFromType(monster.type ?? ''))));
}

function shrinkToInnerFloor(
  cells: Array<{ col: number; row: number }>,
): Array<{ col: number; row: number }> {
  if (cells.length <= 4) return cells;
  const minC = Math.min(...cells.map((c) => c.col));
  const maxC = Math.max(...cells.map((c) => c.col));
  const minR = Math.min(...cells.map((c) => c.row));
  const maxR = Math.max(...cells.map((c) => c.row));
  if (maxC - minC < 2 || maxR - minR < 2) return cells;
  const inner = cells.filter((c) => c.col > minC && c.col < maxC && c.row > minR && c.row < maxR);
  return inner.length > 0 ? inner : cells;
}

async function placeGroup(
  map: MapItem,
  monster: CompendiumMonster,
  points: Array<{ x: number; y: number }>,
  extra?: { skipBoundsClamp?: boolean; sizeCells?: number },
): Promise<void> {
  const encounterGroupId = uuidv4();
  for (const at of points) {
    await summonMonster(monster, at, {
      map,
      select: false,
      skipPortraitLookup: true,
      skipSnap: true,
      skipBoundsClamp: extra?.skipBoundsClamp,
      sizeCells: extra?.sizeCells,
      encounterGroupId,
    });
  }
}

function pickOrigins(
  rnd: () => number,
  cells: Array<{ col: number; row: number }>,
  count: number,
): Array<{ col: number; row: number }> {
  if (cells.length === 0 || count <= 0) return [];
  const remaining = [...cells];
  const out: Array<{ col: number; row: number }> = [];
  const firstIdx = Math.floor(rnd() * remaining.length);
  out.push(remaining.splice(firstIdx, 1)[0]!);
  while (remaining.length > 0 && out.length < count) {
    let bestIdx = 0;
    let bestScore = -1;
    for (let i = 0; i < remaining.length; i++) {
      const c = remaining[i]!;
      let nearest = Infinity;
      for (const placed of out) {
        nearest = Math.min(nearest, Math.hypot(c.col - placed.col, c.row - placed.row));
      }
      const score = nearest + rnd() * 0.2;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    out.push(remaining.splice(bestIdx, 1)[0]!);
  }
  return out;
}

function isFloor(dungeon: GeneratedDungeon, col: number, row: number): boolean {
  if (col < 0 || row < 0 || col >= dungeon.cols || row >= dungeon.rows) return false;
  return dungeon.floor[row * dungeon.cols + col] === 1;
}

function footprintFits(
  dungeon: GeneratedDungeon,
  blocked: Set<string>,
  col: number,
  row: number,
  need: number,
): boolean {
  for (let dy = 0; dy < need; dy++) {
    for (let dx = 0; dx < need; dx++) {
      const c = col + dx;
      const r = row + dy;
      if (!isFloor(dungeon, c, r) || blocked.has(`${c},${r}`)) return false;
    }
  }
  return true;
}

function interiorFloor(
  dungeon: GeneratedDungeon,
  col: number,
  row: number,
): boolean {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!isFloor(dungeon, col + dx, row + dy)) return false;
    }
  }
  return true;
}

function floorOrigins(
  dungeon: GeneratedDungeon,
  blocked: Set<string>,
  room: { x: number; y: number; w: number; h: number },
  need: number,
): Array<{ col: number; row: number }> {
  const padded: Array<{ col: number; row: number }> = [];
  const loose: Array<{ col: number; row: number }> = [];
  for (let row = room.y; row <= room.y + room.h - need; row++) {
    for (let col = room.x; col <= room.x + room.w - need; col++) {
      if (!footprintFits(dungeon, blocked, col, row, need)) continue;
      if (interiorFloor(dungeon, col, row) && interiorFloor(dungeon, col + need - 1, row + need - 1)) {
        padded.push({ col, row });
      } else {
        loose.push({ col, row });
      }
    }
  }
  return padded.length > 0 ? padded : loose;
}

export async function spawnDungeonMonsters(
  map: MapItem,
  dungeon: GeneratedDungeon,
  opts?: DungeonMonsterSpawnOpts,
): Promise<void> {
  const partyLevel = opts?.partyLevel ?? partyLevelFromTokens() ?? 3;
  const partySize = partySizeFromTokens();
  const rnd = mulberry32((dungeon.keyText.length * 131 + map.x + partyLevel * 17) >>> 0);
  let pool: CompendiumMonster[];
  try {
    pool = await loadPool(0, partyLevel + 4);
  } catch {
    return;
  }
  if (pool.length === 0) return;
  const usedNames = new Set<string>();
  const blocked = new Set(dungeon.stairs.map((s) => `${s.x},${s.y}`));

  for (let i = 0; i < dungeon.rooms.length; i++) {
    const room = dungeon.rooms[i]!;
    const diff = difficultyFor(room.title, room.notes, i, dungeon.rooms.length, rnd);
    if (diff === 'skip') continue;
    const band = crWindow(partyLevel, diff);
    const lore = loreForRoom(dungeon.motif, room.title, room.notes, opts?.theme ?? dungeon.theme);
    const pick = pickFromPool(pool, lore, band.min, band.max, diff === 'deadly', partyLevel, rnd, usedNames);
    if (!pick) continue;
    usedNames.add(pick.name.toLowerCase());
    const budget = (THRESHOLD[partyLevel] ?? THRESHOLD[3]!)[diff] * partySize;
    const need = Math.min(2, tokenCellsFor(pick));
    let cells = floorOrigins(dungeon, blocked, room, need);
    if (cells.length === 0 && need > 1) cells = floorOrigins(dungeon, blocked, room, 1);
    if (cells.length === 0) continue;
    const count = pickCount(pick, budget, Math.max(1, Math.floor(cells.length / 2)), diff === 'deadly');
    const origins = pickOrigins(rnd, cells, count);
    const ox = map.x + map.gridOffsetX;
    const oy = map.y + map.gridOffsetY;
    const points = origins.map((c) => ({
      x: ox + c.col * dungeon.cell,
      y: oy + c.row * dungeon.cell,
    }));
    await placeGroup(map, pick, points);
  }
}

export async function spawnModularDungeonMonsters(
  rooms: Array<ModularFurnishRoom & { map: MapItem }>,
  motif: DungeonMotif,
  seed: number,
  opts?: DungeonMonsterSpawnOpts,
): Promise<void> {
  if (rooms.length === 0) return;
  const partyLevel = opts?.partyLevel ?? partyLevelFromTokens() ?? 3;
  const partySize = partySizeFromTokens();
  const rnd = mulberry32((seed ^ 0x85ebca6b ^ partyLevel) >>> 0);
  let pool: CompendiumMonster[];
  try {
    pool = await loadPool(0, partyLevel + 4);
  } catch {
    return;
  }
  if (pool.length === 0) return;
  const usedNames = new Set<string>();
  const cell = MODULAR_PX_PER_UNIT;

  for (let i = 0; i < rooms.length; i++) {
    const room = rooms[i]!;
    const diff = difficultyFor(room.title, room.notes, i, rooms.length, rnd);
    if (diff === 'skip') continue;
    const band = crWindow(partyLevel, diff);
    const lore = loreForRoom(motif, room.title, room.notes, opts?.theme);
    const pick = pickFromPool(pool, lore, band.min, band.max, diff === 'deadly', partyLevel, rnd, usedNames);
    if (!pick) continue;
    usedNames.add(pick.name.toLowerCase());
    const budget = (THRESHOLD[partyLevel] ?? THRESHOLD[3]!)[diff] * partySize;
    const map = room.map;
    const grid = map.gridSize || cell;
    const wall = grid * MODULAR_ROOM_WALL_CELLS;
    let need = Math.min(2, tokenCellsFor(pick));
    const innerW = map.width - wall * 2;
    const innerH = map.height - wall * 2;
    if (innerW < grid || innerH < grid) continue;
    if (need * grid > innerW || need * grid > innerH) need = 1;
    const tokenW = need * grid;
    const cols = Math.max(1, Math.floor((innerW - tokenW) / grid) + 1);
    const rows = Math.max(1, Math.floor((innerH - tokenW) / grid) + 1);
    const slots: Array<{ col: number; row: number }> = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) slots.push({ col, row });
    }
    const count = pickCount(pick, budget, Math.max(1, Math.min(3, slots.length)), diff === 'deadly');
    const origins = pickOrigins(rnd, shrinkToInnerFloor(slots), count);
    const points = origins.map((c) => {
      const localCx = wall + c.col * grid + tokenW / 2;
      const localCy = wall + c.row * grid + tokenW / 2;
      const world = mapLocalPointToWorld(localCx, localCy, map);
      return { x: world.x - tokenW / 2, y: world.y - tokenW / 2 };
    });
    await placeGroup(map, pick, points, { skipBoundsClamp: true, sizeCells: need });
  }
}
