import { v4 as uuidv4 } from 'uuid';
import { monsterToTokenDefaults } from '@grimoire/monster-dex';
import type { CompendiumMonster } from '@grimoire/shared';
import { getActiveMap, useItemStore } from '@/systems/scene/store/itemStore';
import { emitItemAdd } from '@/systems/scene/sceneSync';
import { gridInfoForMap, snapPoint, snapPointToGrid } from '@/systems/scene/snap';
import type { MapItem, TokenItem } from '@/systems/scene/types';
import { getEntryImages } from './compendiumApi';
import { preloadCompendiumImageUrl } from './preloadCompendiumImage';
import { parseAbilities, parseStatsObject } from './statBlockParser';

function abilityFromMonster(monster: CompendiumMonster, name: 'DEX' | 'INT'): { score: number; mod: number } | undefined {
  if (monster.stats) {
    const parsed = parseStatsObject(monster.stats);
    const hit = parsed.find((a) => a.name === name);
    if (hit) return { score: hit.score, mod: hit.mod };
  }
  const fromText = parseAbilities(monster.description ?? '');
  const hit = fromText.find((a) => a.name === name);
  return hit ? { score: hit.score, mod: hit.mod } : undefined;
}

function dexModFromMonster(monster: CompendiumMonster): number | undefined {
  return abilityFromMonster(monster, 'DEX')?.mod;
}

export interface SummonPosition {
  x: number;
  y: number;
}

async function resolveMonsterPortrait(monster: CompendiumMonster): Promise<string | undefined> {
  if (monster.imageUrl) return monster.imageUrl;
  if (monster.image && !monster.image.includes('static-image')) return monster.image;
  try {
    const state = await getEntryImages('monster', monster.id);
    return state.current ?? monster.imageUrl ?? undefined;
  } catch {
    return monster.imageUrl;
  }
}

export async function summonMonster(
  monster: CompendiumMonster,
  at?: SummonPosition,
  opts?: {
    hidden?: boolean;
    map?: MapItem;
    select?: boolean;
    skipPortraitLookup?: boolean;
    skipSnap?: boolean;
    skipBoundsClamp?: boolean;
    sizeCells?: number;
    encounterGroupId?: string;
  },
): Promise<TokenItem | null> {
  const map = opts?.map ?? getActiveMap();
  if (!map) return null;

  const portrait = opts?.skipPortraitLookup
    ? (monster.imageUrl ?? (monster.image && !monster.image.includes('static-image') ? monster.image : undefined))
    : await resolveMonsterPortrait(monster);
  preloadCompendiumImageUrl(portrait);

  const grid = map.gridSize;
  const defaults = monsterToTokenDefaults(
    { ...monster, ...(portrait ? { imageUrl: portrait } : {}) },
    grid,
  );
  if (opts?.sizeCells != null && opts.sizeCells > 0) {
    const cells = opts.sizeCells;
    defaults.sizeCells = cells;
    defaults.width = cells * grid;
    defaults.height = cells * grid;
  }

  let x: number;
  let y: number;
  if (at) {
    const snapped = opts?.skipSnap
      ? at
      : opts?.map
        ? snapPointToGrid(gridInfoForMap(map), at.x, at.y)
        : snapPoint(at.x, at.y);
    x = snapped.x;
    y = snapped.y;
  } else {
    const tokens = Object.values(useItemStore.getState().items).filter((i) => i.type === 'token');
    const count = tokens.length;
    const col = count % 10;
    const row = Math.floor(count / 10);
    x = map.x + map.gridOffsetX + col * grid;
    y = map.y + map.gridOffsetY + row * grid;
  }

  const dexMod = dexModFromMonster(monster);
  const intScore = abilityFromMonster(monster, 'INT')?.score;
  if (!opts?.skipBoundsClamp) {
    x = Math.min(map.x + map.width - defaults.width, Math.max(map.x, x));
    y = Math.min(map.y + map.height - defaults.height, Math.max(map.y, y));
  }

  const token: TokenItem = {
    id: uuidv4(),
    type: 'token',
    x,
    y,
    rotation: 0,
    width: defaults.width,
    height: defaults.height,
    zIndex: 0,
    locked: false,
    visible: opts?.hidden ? false : true,
    name: defaults.name,
    sizeCells: defaults.sizeCells,
    hp: defaults.hp,
    maxHp: defaults.maxHp,
    ac: defaults.ac,
    tempHp: 0,
    conditions: [],
    monsterId: defaults.monsterId,
    monsterCr: defaults.monsterCr,
    monsterSource: defaults.monsterSource,
    hideHpFromPlayers: true,
    ...(dexMod !== undefined ? { initiativeMod: dexMod } : {}),
    ...(intScore !== undefined ? { monsterInt: intScore } : {}),
    ...(opts?.encounterGroupId ? { encounterGroupId: opts.encounterGroupId } : {}),
    ...(defaults.imageUrl ? { imageUrl: defaults.imageUrl } : {}),
  };

  useItemStore.getState().addItem(token);
  emitItemAdd(token);
  if (opts?.select !== false) useItemStore.getState().select([token.id], 'set');
  return token;
}
