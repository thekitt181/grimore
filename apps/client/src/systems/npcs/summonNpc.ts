import { v4 as uuidv4 } from 'uuid';
import { getActiveMap, useItemStore } from '@/systems/scene/store/itemStore';
import { emitItemAdd } from '@/systems/scene/sceneSync';
import type { TokenItem } from '@/systems/scene/types';
import type { NpcRecord } from './npcTypes';

export function summonNpc(npc: NpcRecord): TokenItem | null {
  const map = getActiveMap();
  if (!map) return null;
  const grid = map.gridSize;
  const tokens = Object.values(useItemStore.getState().items).filter((item) => item.type === 'token');
  const count = tokens.length;
  const col = count % 10;
  const row = Math.floor(count / 10);
  const credit = npc.portrait
    ? `${npc.portrait.creator} (${npc.portrait.license})`
    : 'NPC codex';
  const token: TokenItem = {
    id: uuidv4(),
    type: 'token',
    x: map.x + map.gridOffsetX + col * grid,
    y: map.y + map.gridOffsetY + row * grid,
    rotation: 0,
    width: grid,
    height: grid,
    zIndex: 0,
    locked: false,
    visible: true,
    name: npc.name,
    sizeCells: 1,
    hp: npc.hp,
    maxHp: npc.hp,
    tempHp: 0,
    ac: npc.ac,
    conditions: [],
    hideHpFromPlayers: true,
    monsterSource: credit,
    ...(npc.attack.trim() ? { attackText: npc.attack.trim() } : {}),
    ...(npc.portrait ? { imageUrl: npc.portrait.thumbUrl || npc.portrait.imageUrl } : {}),
  };
  useItemStore.getState().addItem(token);
  emitItemAdd(token);
  useItemStore.getState().select([token.id], 'set');
  return token;
}
