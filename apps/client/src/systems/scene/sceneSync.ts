import { getSocket } from '@/lib/socket';
import { useSessionStore } from '@/store/sessionStore';
import { useItemStore } from './store/itemStore';
import { addDeletedIds, persistItemsLocal } from './sessionPersistence';
import type { Item } from './types';

function sid(): string | null {
  return useSessionStore.getState().sessionId;
}

function snapshotItems(): Item[] {
  return Object.values(useItemStore.getState().items) as Item[];
}

function emitIfConnected(event: string, payload: Record<string, unknown>): boolean {
  const socket = getSocket();
  if (!socket.connected) return false;
  (socket as { emit: (event: string, payload: unknown) => void }).emit(event, payload);
  return true;
}

/** Save locally on every edit; full server snapshot only when GM explicitly syncs. */
function persistScene(fullSync = false) {
  const s = sid();
  if (!s) return;
  persistItemsLocal(s, snapshotItems());

  if (!fullSync) return;
  if (useSessionStore.getState().myRole !== 'GM') return;
  emitIfConnected('items:sync', { sessionId: s, items: snapshotItems() });
}

export function emitItemAdd(item: Item) {
  const s = sid();
  if (!s) return;
  emitIfConnected('item:add', { sessionId: s, item });
  persistScene();
}

export function emitItemUpdate(patches: Array<{ id: string; patch: Partial<Item> }>) {
  const s = sid();
  if (!s || !patches.length) return;
  emitIfConnected('item:update', { sessionId: s, patches });
  persistScene();
}

export function emitItemRemove(ids: string[]) {
  const s = sid();
  if (!s || !ids.length) return;
  addDeletedIds(s, ids);
  emitIfConnected('item:remove', { sessionId: s, ids });
  persistScene(true);
}

/** GM pushes a full snapshot (used when a player joins or after hydration). */
export function emitItemsSync(items: Item[]) {
  const s = sid();
  if (!s) return;
  if (useSessionStore.getState().myRole !== 'GM') return;
  persistItemsLocal(s, items);
  emitIfConnected('items:sync', { sessionId: s, items });
}

/** Ask server to resend cached fog + items (after listeners attach). */
export function requestSceneHydrate(): void {
  const s = sid();
  if (!s) return;
  emitIfConnected('session:requestHydrate', { sessionId: s });
}
