import { getSocket } from '@/lib/socket';
import { useSessionStore } from '@/store/sessionStore';
import { useItemStore } from './store/itemStore';
import { addDeletedIds, persistItemsLocal } from './sessionPersistence';
import type { Item } from './types';

let pendingServerSync: ReturnType<typeof setTimeout> | null = null;

function sid(): string | null {
  return useSessionStore.getState().sessionId;
}

function snapshotItems(): Item[] {
  return Object.values(useItemStore.getState().items) as Item[];
}

/** Save locally on every edit; full server snapshot only on explicit sync (join/remove). */
function persistScene(fullSync = false) {
  const s = sid();
  if (!s) return;
  persistItemsLocal(s, snapshotItems());

  if (!fullSync) return;

  if (pendingServerSync) clearTimeout(pendingServerSync);
  pendingServerSync = null;
  (getSocket() as any).emit('items:sync', { sessionId: s, items: snapshotItems() });
}

export function emitItemAdd(item: Item) {
  const s = sid();
  if (!s) return;
  (getSocket() as any).emit('item:add', { sessionId: s, item });
  persistScene();
}

export function emitItemUpdate(patches: Array<{ id: string; patch: Partial<Item> }>) {
  const s = sid();
  if (!s || !patches.length) return;
  (getSocket() as any).emit('item:update', { sessionId: s, patches });
  persistScene();
}

export function emitItemRemove(ids: string[]) {
  const s = sid();
  if (!s || !ids.length) return;
  addDeletedIds(s, ids);
  (getSocket() as any).emit('item:remove', { sessionId: s, ids });
  persistScene(true);
}

/** GM pushes a full snapshot (used when a player joins or after hydration). */
export function emitItemsSync(items: Item[]) {
  const s = sid();
  if (!s) return;
  if (pendingServerSync) clearTimeout(pendingServerSync);
  pendingServerSync = null;
  persistItemsLocal(s, items);
  (getSocket() as any).emit('items:sync', { sessionId: s, items });
}
