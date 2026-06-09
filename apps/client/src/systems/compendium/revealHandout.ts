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
    ...(handout.imageUrl ? { imageUrl: handout.imageUrl } : {}),
    targetUserIds: 'all',
  });
}
