import { v4 as uuidv4 } from 'uuid';
import { getActiveMap, useItemStore } from '@/systems/scene/store/itemStore';
import { emitItemAdd } from '@/systems/scene/sceneSync';
import { snapPoint } from '@/systems/scene/snap';
import type { HandoutItem, Item } from '@/systems/scene/types';
import { getItem, type LootDrop } from './compendiumApi';
import { placeItemHandout } from './placeItemHandout';

function handoutSize(grid: number): { width: number; height: number } {
  return { width: grid, height: Math.round(grid * 1.35) };
}

function ringPoint(
  target: { x: number; y: number; width: number; height: number },
  index: number,
  count: number,
  grid: number,
): { x: number; y: number } {
  const { width, height } = handoutSize(grid);
  const cx = target.x + target.width / 2;
  const cy = target.y + target.height / 2;
  const reach = Math.max(target.width, target.height) / 2 + grid * 1.15;
  const angle = -Math.PI / 2 + (index / Math.max(count, 1)) * Math.PI * 2;
  return snapPoint(cx + Math.cos(angle) * reach - width / 2, cy + Math.sin(angle) * reach - height / 2);
}

function stackPoint(grid: number, map: { x: number; y: number; gridOffsetX: number; gridOffsetY: number }, slot: number) {
  return snapPoint(
    map.x + map.gridOffsetX + (slot % 10) * grid,
    map.y + map.gridOffsetY + Math.floor(slot / 10) * grid,
  );
}

function placePlainHandout(
  name: string,
  description: string,
  itemType: string,
  at: { x: number; y: number },
  source = 'Loot',
): boolean {
  const map = getActiveMap();
  if (!map) return false;
  const { width, height } = handoutSize(map.gridSize);
  const handout: HandoutItem = {
    id: uuidv4(),
    type: 'handout',
    x: at.x,
    y: at.y,
    rotation: 0,
    width,
    height,
    zIndex: 0,
    locked: false,
    visible: false,
    name,
    compendiumItemId: itemType === 'Currency' ? 'loot-currency' : 'loot-flavor',
    itemType,
    description,
    source,
  };
  useItemStore.getState().addItem(handout);
  emitItemAdd(handout);
  return true;
}

export async function placeLootDrops(drops: LootDrop[], aroundId?: string): Promise<boolean> {
  const map = getActiveMap();
  if (!map || drops.length === 0) return false;
  let around: { x: number; y: number; width: number; height: number } | null = null;
  if (aroundId) {
    const target = useItemStore.getState().items[aroundId];
    if (!target) return false;
    around = target;
  }
  let stack = Object.values(useItemStore.getState().items).filter((item) => item.type === 'handout').length;

  for (let index = 0; index < drops.length; index += 1) {
    const drop = drops[index]!;
    const at = around
      ? ringPoint(around, index, drops.length, map.gridSize)
      : stackPoint(map.gridSize, map, stack);
    stack += 1;
    if (drop.kind === 'item') {
      const item = await getItem(drop.id);
      const placed = await placeItemHandout(item, at);
      if (!placed) return false;
      continue;
    }
    if (drop.kind === 'currency') {
      if (!placePlainHandout(drop.label, `A cache of coins: ${drop.label}.`, 'Currency', at)) return false;
      continue;
    }
    if (!placePlainHandout(drop.name, drop.detail, 'Trinket', at)) return false;
  }
  return true;
}

export async function placeShopPurchases(
  lines: Array<{ id?: string; name: string; cost: string }>,
): Promise<boolean> {
  const map = getActiveMap();
  if (!map || lines.length === 0) return false;
  let stack = Object.values(useItemStore.getState().items).filter((item) => item.type === 'handout').length;
  for (const line of lines) {
    const at = stackPoint(map.gridSize, map, stack);
    stack += 1;
    if (line.id) {
      try {
        const item = await getItem(line.id);
        const placed = await placeItemHandout(item, at);
        if (placed) continue;
      } catch {
        // Mundane or missing codex rows still land as a handout.
      }
    }
    if (!placePlainHandout(line.name, `Bought for ${line.cost}.`, 'Goods', at, 'Shop')) return false;
  }
  return true;
}

export function lootSubjectName(item: Item): string {
  if (item.type === 'text') return item.text.trim().slice(0, 48) || 'Text';
  if ('name' in item && typeof item.name === 'string' && item.name.trim()) return item.name.trim();
  return item.type;
}
