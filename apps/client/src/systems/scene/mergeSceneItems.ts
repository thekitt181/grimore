import type { Item, MapItem } from './types';
import { isPersistableImageUrl } from '@/lib/imagePersistence';
import { isGrimoireModelRef } from '@/lib/modelAssetStore';

function pickAssetUrl(a: string | null, b: string | null): string | null {
  if (a && (isPersistableImageUrl(a) || isGrimoireModelRef(a))) return a;
  if (b && (isPersistableImageUrl(b) || isGrimoireModelRef(b))) return b;
  return null;
}

function pickBackgroundUrl(a: string | null, b: string | null): string | null {
  return pickAssetUrl(a, b);
}

function mergeMapItem(server: MapItem, local: MapItem): MapItem {
  return {
    ...server,
    backgroundUrl: pickBackgroundUrl(server.backgroundUrl, local.backgroundUrl),
    modelUrl: pickAssetUrl(local.modelUrl ?? null, server.modelUrl ?? null),
    walls: (server.walls?.length ? server.walls : local.walls) ?? [],
    width: server.width || local.width,
    height: server.height || local.height,
    gridSize: server.gridSize || local.gridSize,
    gridOffsetX: server.gridOffsetX ?? local.gridOffsetX,
    gridOffsetY: server.gridOffsetY ?? local.gridOffsetY,
  };
}

/** Prefer local map images/walls when server snapshot is stale or incomplete. */
export function mergeSceneItems(
  server: Item[],
  local: Item[],
  deletedIds: Set<string> = new Set(),
): Item[] {
  const localById = new Map(local.map((i) => [i.id, i]));
  const seen = new Set<string>();
  const merged: Item[] = [];

  for (const item of server) {
    if (deletedIds.has(item.id)) continue;
    seen.add(item.id);
    const loc = localById.get(item.id);
    if (item.type === 'map' && loc?.type === 'map') {
      merged.push(mergeMapItem(item, loc));
    } else if (item.type === 'token' && loc?.type === 'token') {
      const imageUrl = pickBackgroundUrl(loc.imageUrl ?? null, item.imageUrl ?? null);
      const modelUrl = pickAssetUrl(loc.modelUrl ?? null, item.modelUrl ?? null);
      const mergedToken = { ...item } as typeof item;
      if (imageUrl) mergedToken.imageUrl = imageUrl;
      else delete mergedToken.imageUrl;
      if (modelUrl) mergedToken.modelUrl = modelUrl;
      else delete mergedToken.modelUrl;
      merged.push(mergedToken);
    } else if (item.type === 'handout' && loc?.type === 'handout') {
      const imageUrl = pickBackgroundUrl(item.imageUrl ?? null, loc.imageUrl ?? null);
      if (imageUrl) merged.push({ ...item, imageUrl });
      else {
        const { imageUrl: _drop, ...rest } = item;
        merged.push(rest);
      }
    } else {
      merged.push(item);
    }
  }

  for (const item of local) {
    if (!seen.has(item.id) && !deletedIds.has(item.id)) merged.push(item);
  }

  return merged;
}

/** Skip store updates when reconnect sync did not change meaningful item data. */
export function sameSceneItemSnapshot(items: Item[], current: Record<string, Item>): boolean {
  const merged = [...items].sort((a, b) => a.id.localeCompare(b.id));
  const currentList = Object.values(current).sort((a, b) => a.id.localeCompare(b.id));
  if (merged.length !== currentList.length) return false;
  try {
    return JSON.stringify(merged) === JSON.stringify(currentList);
  } catch {
    return false;
  }
}

/** Strip dead blob URLs so maps render the placeholder instead of failing silently. */
export function sanitizePersistedItems(items: Item[]): Item[] {
  return items.map((item) => {
    if (item.type === 'map') {
      const m = item as MapItem;
      let next = m;
      if (m.backgroundUrl && !isPersistableImageUrl(m.backgroundUrl)) {
        next = { ...next, backgroundUrl: null };
      }
      if (m.modelUrl && !isPersistableImageUrl(m.modelUrl) && !isGrimoireModelRef(m.modelUrl)) {
        next = { ...next, modelUrl: null };
      }
      if (next !== m) return next;
    }
    if (item.type === 'token' && item.modelUrl && !isPersistableImageUrl(item.modelUrl) && !isGrimoireModelRef(item.modelUrl)) {
      const { modelUrl: _dead, ...rest } = item;
      return rest;
    }
    if (item.type === 'token' && item.imageUrl && !isPersistableImageUrl(item.imageUrl)) {
      const { imageUrl: _dead, ...rest } = item;
      return rest;
    }
    if (item.type === 'handout' && item.imageUrl && !isPersistableImageUrl(item.imageUrl)) {
      const { imageUrl: _dead, ...rest } = item;
      return rest;
    }
    return item;
  });
}
