import { v4 as uuidv4 } from 'uuid';
import { monsterToTokenDefaults } from '@grimoire/monster-dex';
import type { CompendiumMonster } from '@grimoire/shared';
import { getActiveMap, useItemStore } from '@/systems/scene/store/itemStore';
import { emitItemAdd } from '@/systems/scene/sceneSync';
import { snapPoint } from '@/systems/scene/snap';
import type { TokenItem } from '@/systems/scene/types';
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

export function summonMonster(monster: CompendiumMonster, at?: SummonPosition): TokenItem | null {
  const map = getActiveMap();
  if (!map) return null;

  const grid = map.gridSize;
  const defaults = monsterToTokenDefaults(
    { ...monster, ...(monster.imageUrl ? { imageUrl: monster.imageUrl } : {}) },
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
    visible: true,
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
