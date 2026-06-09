import { v4 as uuidv4 } from 'uuid';
import type { CompendiumItem } from '@grimoire/shared';
import { getActiveMap, useItemStore } from '@/systems/scene/store/itemStore';
import { emitItemAdd } from '@/systems/scene/sceneSync';
import { snapPoint } from '@/systems/scene/snap';
import type { HandoutItem } from '@/systems/scene/types';
import { getEntryImages } from './compendiumApi';
import { preloadCompendiumImageUrl } from './preloadCompendiumImage';

export interface HandoutPosition {
  x: number;
  y: number;
}

export async function placeItemHandout(item: CompendiumItem, at?: HandoutPosition): Promise<HandoutItem | null> {
  const map = getActiveMap();
  if (!map) return null;

  let imageUrl = item.imageUrl;
  if (!imageUrl) {
    try {
      const state = await getEntryImages('item', item.id);
      imageUrl = state.current ?? undefined;
    } catch {
      // handout still places without image
    }
  }

  preloadCompendiumImageUrl(imageUrl);

  const grid = map.gridSize;
  const width = grid;
  const height = Math.round(grid * 1.35);

  let x: number;
  let y: number;
  if (at) {
    const snapped = snapPoint(at.x, at.y);
    x = snapped.x;
    y = snapped.y;
  } else {
    const handouts = Object.values(useItemStore.getState().items).filter((i) => i.type === 'handout');
    const count = handouts.length;
    const col = count % 10;
    const row = Math.floor(count / 10);
    x = map.x + map.gridOffsetX + col * grid;
    y = map.y + map.gridOffsetY + row * grid;
  }

  const handout: HandoutItem = {
    id: uuidv4(),
    type: 'handout',
    x,
    y,
    rotation: 0,
    width,
    height,
    zIndex: 0,
    locked: false,
    visible: false,
    name: item.name,
    compendiumItemId: item.id,
    description: item.description || item.flavor || '',
    ...(item.type ? { itemType: item.type } : {}),
    ...(item.rarity ? { rarity: item.rarity } : {}),
    ...(item.source ? { source: item.source } : {}),
    ...(imageUrl ? { imageUrl } : {}),
  };

  useItemStore.getState().addItem(handout);
  emitItemAdd(handout);
  useItemStore.getState().select([handout.id], 'set');
  return handout;
}
