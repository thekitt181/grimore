import { v4 as uuidv4 } from 'uuid';
import type { DdbEncounterMonster } from '@grimoire/shared';
import { searchMonsters } from '@/systems/compendium/compendiumApi';
import { summonMonster } from '@/systems/compendium/summonMonster';
import { getActiveMap, useItemStore } from '@/systems/scene/store/itemStore';
import { emitItemAdd } from '@/systems/scene/sceneSync';
import type { TokenItem } from '@/systems/scene/types';

export async function summonEncounterMonsters(monsters: DdbEncounterMonster[]): Promise<TokenItem[]> {
  const map = getActiveMap();
  if (!map) return [];

  const grid = map.gridSize;
  const spawned: TokenItem[] = [];
  let index = 0;

  for (const m of monsters) {
    for (let q = 0; q < m.count; q++) {
      const col = index % 8;
      const row = Math.floor(index / 8);
      const x = map.x + map.gridOffsetX + col * grid * 1.5;
      const y = map.y + map.gridOffsetY + row * grid * 1.5;
      index++;

      if (m.ddbMonsterId) {
        try {
          const result = await searchMonsters({ q: m.name, limit: 1 });
          const match = result.items[0];
          if (match) {
            const token = summonMonster(match, { x, y });
            if (token) spawned.push(token);
            continue;
          }
        } catch {
          /* fall through to basic token */
        }
      }

      const token: TokenItem = {
        id: uuidv4(),
        type: 'token',
        x,
        y,
        rotation: 0,
        width: grid,
        height: grid,
        zIndex: 0,
        locked: false,
        visible: true,
        name: m.count > 1 ? `${m.name} ${q + 1}` : m.name,
        sizeCells: 1,
        hp: m.hp ?? 10,
        maxHp: m.hp ?? 10,
        tempHp: 0,
        ac: m.ac ?? 10,
        conditions: [],
        hideHpFromPlayers: true,
      };
      useItemStore.getState().addItem(token);
      emitItemAdd(token);
      spawned.push(token);
    }
  }

  return spawned;
}
