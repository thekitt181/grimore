import { evictTexture } from '@/lib/textureLoader';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { emitItemUpdate } from '@/systems/scene/sceneSync';
import type { HandoutItem } from '@/systems/scene/types';

/** Push a compendium image URL onto every matching item handout on the map. */
export function syncCompendiumImageToHandouts(compendiumItemId: string, imageUrl: string | null) {
  const store = useItemStore.getState();
  const updates: Array<{ id: string; patch: Partial<HandoutItem> }> = [];

  for (const item of Object.values(store.items)) {
    if (item.type !== 'handout' || item.compendiumItemId !== compendiumItemId) continue;
    if (item.imageUrl) evictTexture(item.imageUrl);
    if (imageUrl) {
      updates.push({ id: item.id, patch: { imageUrl } });
    } else {
      const { imageUrl: _removed, ...rest } = item;
      updates.push({ id: item.id, patch: rest });
    }
  }

  if (updates.length === 0) return;

  store.updateItems(updates);
  emitItemUpdate(updates);
}
