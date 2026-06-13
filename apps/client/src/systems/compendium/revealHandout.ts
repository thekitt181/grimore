import { getSocket } from '@/lib/socket';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { emitItemUpdate } from '@/systems/scene/sceneSync';
import type { HandoutItem } from '@/systems/scene/types';

export function revealHandoutToPlayers(handout: HandoutItem, sessionId: string): void {
  if (!handout.visible) {
    useItemStore.getState().updateItem(handout.id, { visible: true });
    emitItemUpdate([{ id: handout.id, patch: { visible: true } }]);
  }

  getSocket().emit('handout:reveal', {
    sessionId,
    handoutId: handout.id,
    title: handout.name,
    content: handout.description,
    type: 'ITEM_CARD',
    itemMeta: {
      name: handout.name,
      ...(handout.itemType ? { itemType: handout.itemType } : {}),
      ...(handout.rarity ? { rarity: handout.rarity } : {}),
      ...(handout.source ? { source: handout.source } : {}),
      compendiumItemId: handout.compendiumItemId,
      isCustom: (handout.source ?? '').trim().toLowerCase() === 'custom',
    },
    ...(handout.imageUrl ? { imageUrl: handout.imageUrl } : {}),
    targetUserIds: 'all',
    animate: true,
  });
}
