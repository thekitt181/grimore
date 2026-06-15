import { getSessionItems, setSessionItems } from './redis';
import type { ItemAddPayload, ItemRemovePayload, ItemUpdatePayload } from '@grimoire/shared';

type CachedItem = Record<string, unknown> & { id?: string };

async function loadCachedItems(sessionId: string): Promise<CachedItem[]> {
  const raw = await getSessionItems(sessionId);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as CachedItem[]) : [];
  } catch {
    return [];
  }
}

async function saveCachedItems(sessionId: string, items: CachedItem[]): Promise<void> {
  await setSessionItems(sessionId, JSON.stringify(items));
}

/** item:add — append to Redis snapshot so hydrate matches live session. */
export async function cacheItemAdd(payload: ItemAddPayload): Promise<void> {
  const item = payload.item as CachedItem | null;
  if (!item?.id) return;
  const items = await loadCachedItems(payload.sessionId);
  const idx = items.findIndex((i) => i.id === item.id);
  if (idx >= 0) items[idx] = { ...items[idx], ...item };
  else items.push(item);
  await saveCachedItems(payload.sessionId, items);
}

/** item:update — patch cached snapshot. */
export async function cacheItemUpdate(payload: ItemUpdatePayload): Promise<void> {
  if (!payload.patches.length) return;
  const patchById = new Map(payload.patches.map((p) => [p.id, p.patch]));
  const items = await loadCachedItems(payload.sessionId);
  let changed = false;
  const next = items.map((item) => {
    const id = item.id;
    if (!id || !patchById.has(id)) return item;
    changed = true;
    return { ...item, ...patchById.get(id)! };
  });
  if (changed) await saveCachedItems(payload.sessionId, next);
}

/** item:remove — drop ids from cached snapshot (fixes ghost maps on player hydrate). */
export async function cacheItemRemove(payload: ItemRemovePayload): Promise<void> {
  if (!payload.ids.length) return;
  const remove = new Set(payload.ids);
  const items = await loadCachedItems(payload.sessionId);
  const next = items.filter((item) => !item.id || !remove.has(item.id));
  await saveCachedItems(payload.sessionId, next);
}
