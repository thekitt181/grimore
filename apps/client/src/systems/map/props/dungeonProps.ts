import { v4 as uuidv4 } from 'uuid';
import { getActiveMap, useItemStore } from '@/systems/scene/store/itemStore';
import { emitItemAdd, emitItemUpdate } from '@/systems/scene/sceneSync';
import { hitTest } from '@/systems/scene/hitTest';
import type { ImageItem, MapItem } from '@/systems/scene/types';
import { PROP_ART, propArtById, type PropMotion } from './propArt';

export interface DungeonProp {
  id: string;
  name: string;
  short: string;
  imageUrl: string;
}

export type { PropMotion };

const LEGACY_NAMES: Record<string, string> = {
  Chest: 'chest',
  'Locked chest': 'sarcophagus',
  Coins: 'coins',
  Bones: 'skeleton',
  Skull: 'skull',
  Corpse: 'corpse',
  'Spike trap': 'spear',
  'Bear trap': 'blade',
  'Pressure plate': 'plate',
  Barrel: 'crate',
  Crate: 'crate',
  Rubble: 'boulder',
  Pillar: 'column',
  Altar: 'altar',
  Statue: 'statue',
  Torch: 'torch',
  Campfire: 'campfire',
  'Trap door': 'hatch',
  'Arrow trap': 'arrows',
  Portcullis: 'gate',
};

/** How a prop behaves when someone uses it on the map. */
export function propMotion(id: string): PropMotion {
  return propArtById(id)?.motion ?? 'none';
}

export function canTriggerProp(id: string): boolean {
  const motion = propMotion(id);
  return motion === 'toggle' || motion === 'fire';
}

export function resolvePropId(item: ImageItem): string | undefined {
  if (item.propId) return item.propId;
  if (item.imageUrl.startsWith('/props/')) {
    return DUNGEON_PROPS.find((prop) => prop.imageUrl === item.imageUrl)?.id;
  }
  if (item.imageUrl.startsWith('data:image/svg')) {
    return DUNGEON_PROPS.find((prop) => prop.name === item.name)?.id ?? LEGACY_NAMES[item.name];
  }
  return undefined;
}

export const DUNGEON_PROPS: DungeonProp[] = PROP_ART.map((art) => ({
  id: art.id,
  name: art.name,
  short: art.short,
  imageUrl: art.rest,
}));

function cellCenter(map: MapItem, col: number, row: number): { x: number; y: number } {
  const g = map.gridSize;
  return {
    x: map.x + map.gridOffsetX + (col + 0.5) * g,
    y: map.y + map.gridOffsetY + (row + 0.5) * g,
  };
}

/** Drop a prop on the active map, near the middle, nudged so repeats do not stack. */
export function placeDungeonProp(prop: DungeonProp, hidden: boolean): void {
  const map = getActiveMap();
  if (!map) {
    window.alert('Select a map first.');
    return;
  }

  const same = Object.values(useItemStore.getState().items).filter(
    (item) => item.type === 'image' && item.name === prop.name,
  ).length;
  const cols = Math.max(1, Math.floor(map.width / map.gridSize));
  const rows = Math.max(1, Math.floor(map.height / map.gridSize));
  const col = Math.min(cols - 1, Math.max(0, Math.floor(cols / 2) - 2 + (same % 5)));
  const row = Math.min(rows - 1, Math.max(0, Math.floor(rows / 2) + Math.floor(same / 5)));
  const center = cellCenter(map, col, row);
  const size = map.gridSize;

  const image: ImageItem = {
    id: uuidv4(),
    type: 'image',
    name: prop.name,
    imageUrl: prop.imageUrl,
    propId: prop.id,
    propState: 0,
    x: center.x - size / 2,
    y: center.y - size / 2,
    rotation: 0,
    width: size,
    height: size,
    zIndex: 1,
    locked: false,
    visible: !hidden,
  };

  const store = useItemStore.getState();
  store.addItem(image);
  emitItemAdd(image);
  store.select([image.id], 'set');
}

/** Play a chest, hatch, or trap on the map. Loops such as torches need no trigger. */
export function triggerDungeonProp(item: ImageItem): void {
  const id = resolvePropId(item);
  if (!id || !canTriggerProp(id)) return;
  const motion = propMotion(id);
  const patch = {
    propId: id,
    propState: motion === 'fire' ? (item.propState ?? 0) + 1 : (item.propState ?? 0) > 0 ? 0 : 1,
    propAt: Date.now(),
  };
  useItemStore.getState().updateItem(item.id, patch);
  emitItemUpdate([{ id: item.id, patch }]);
}

/** Topmost triggerable prop under a world point, or null when a token covers it. */
export function triggerablePropAt(wx: number, wy: number, gm: boolean): ImageItem | null {
  const items = Object.values(useItemStore.getState().items).filter((item) => {
    if (!gm && item.visible === false) return false;
    return item.type !== 'map';
  });
  const hit = hitTest(items, wx, wy, { includeLocked: true });
  if (hit?.type !== 'image') return null;
  const id = resolvePropId(hit);
  if (!id || !canTriggerProp(id)) return null;
  return hit;
}
