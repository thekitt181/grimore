import { v4 as uuidv4 } from 'uuid';
import { monsterToTokenDefaults } from '@grimoire/monster-dex';
import type { CompendiumMonster } from '@grimoire/shared';
import { getActiveMap, useItemStore } from '@/systems/scene/store/itemStore';
import { emitItemAdd } from '@/systems/scene/sceneSync';
import { snapPoint } from '@/systems/scene/snap';
import type { TokenItem } from '@/systems/scene/types';
import { getEntryImages } from './compendiumApi';
import { preloadCompendiumImageUrl } from './preloadCompendiumImage';
import { parseAbilities, parseStatsObject } from './statBlockParser';

function dexModFromMonster(monster: CompendiumMonster): number | undefined {
  if (monster.stats) {
    const parsed = parseStatsObject(monster.stats);
    const dex = parsed.find((a) => a.name === 'DEX');
    if (dex) return dex.mod;
  }
  const fromText = parseAbilities(monster.description ?? '');
  const dex = fromText.find((a) => a.name === 'DEX');
  return dex?.mod;
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
  opts?: { hidden?: boolean },
): Promise<TokenItem | null> {
  const map = getActiveMap();
  if (!map) return null;

  const portrait = await resolveMonsterPortrait(monster);
  preloadCompendiumImageUrl(portrait);

  const grid = map.gridSize;
  const defaults = monsterToTokenDefaults(
    { ...monster, ...(portrait ? { imageUrl: portrait } : {}) },
    grid,
  );

  let x: number;
  let y: number;
  if (at) {
    const snapped = snapPoint(at.x, at.y);
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
    ...(defaults.imageUrl ? { imageUrl: defaults.imageUrl } : {}),
  };

  useItemStore.getState().addItem(token);
  emitItemAdd(token);
  useItemStore.getState().select([token.id], 'set');
  return token;
}
