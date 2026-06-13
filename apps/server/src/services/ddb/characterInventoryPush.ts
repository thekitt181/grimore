import type { HandoutItemMeta } from '@grimoire/shared';
import {
  cobaltCacheId,
  ddbAuthHeaders,
  getBearerToken,
  invalidateBearer,
  normalizeCobaltToken,
} from './cobaltAuth';
import { DDB_URLS } from './config';
import { searchDdbItems } from './ddbLibrary';
import { getDdbAuthContext } from './ddbAuthContext';

const MAGIC_ITEM_ENTITY_TYPE = 112130467;

export interface PushHandoutItemInput {
  name: string;
  description?: string;
  itemType?: string;
  rarity?: string;
  source?: string;
  isCustom?: boolean;
  ddbDefinitionId?: number;
}

async function ddbPost(
  cobalt: string,
  characterId: number,
  url: string,
  body: Record<string, unknown>,
  refreshBearer = false,
): Promise<Response> {
  const token = normalizeCobaltToken(cobalt);
  const cacheId = cobaltCacheId(token);
  if (refreshBearer) await invalidateBearer(cacheId);

  const bearer = await getBearerToken(cacheId, token);
  if (!bearer) return new Response(null, { status: 401 });

  return fetch(url, {
    method: 'POST',
    headers: {
      ...ddbAuthHeaders(token, bearer, { characterId }),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

async function resolveDefinitionId(
  cobalt: string,
  item: PushHandoutItemInput,
): Promise<number | null> {
  if (item.ddbDefinitionId && item.ddbDefinitionId > 0) return item.ddbDefinitionId;
  if (item.isCustom) return null;

  const ctx = await getDdbAuthContext(cobalt);
  if (!ctx) return null;

  const hits = await searchDdbItems(ctx, { q: item.name, limit: 20 });
  const exact = hits.find((h) => h.name.trim().toLowerCase() === item.name.trim().toLowerCase());
  return exact?.ddbId ?? hits[0]?.ddbId ?? null;
}

async function pushOfficialItem(
  cobalt: string,
  characterId: number,
  definitionId: number,
): Promise<boolean> {
  const body = {
    characterId,
    definitionId,
    entityTypeId: MAGIC_ITEM_ENTITY_TYPE,
    quantity: 1,
    equipped: false,
  };

  const urls = [
    `${DDB_URLS.characterBase}/inventory`,
    `${DDB_URLS.characterBase}/inventory/magic-item`,
  ];

  for (const url of urls) {
    let res = await ddbPost(cobalt, characterId, url, body);
    if (res.status === 401 || res.status === 403) {
      res = await ddbPost(cobalt, characterId, url, body, true);
    }
    if (res.ok) {
      const json = (await res.json().catch(() => null)) as { success?: boolean; message?: string } | null;
      if (json && 'success' in json && json.success === false) continue;
      return true;
    }
  }
  return false;
}

async function pushCustomItem(
  cobalt: string,
  characterId: number,
  item: PushHandoutItemInput,
): Promise<boolean> {
  const body = {
    characterId,
    name: item.name,
    description: item.description ?? item.name,
    type: item.itemType ?? 'Wondrous Item',
    rarity: item.rarity ?? 'Common',
    weight: 0,
    cost: 0,
    quantity: 1,
  };

  const urls = [
    `${DDB_URLS.characterBase}/custom-item`,
    `${DDB_URLS.characterBase}/custom-item/create`,
  ];

  for (const url of urls) {
    let res = await ddbPost(cobalt, characterId, url, body);
    if (res.status === 401 || res.status === 403) {
      res = await ddbPost(cobalt, characterId, url, body, true);
    }
    if (res.ok) {
      const json = (await res.json().catch(() => null)) as { success?: boolean; message?: string } | null;
      if (json && 'success' in json && json.success === false) continue;
      return true;
    }
  }
  return false;
}

/** Best-effort push of a handout item card onto a D&D Beyond character sheet. */
export async function pushHandoutItemToDdb(
  cobalt: string,
  characterId: number,
  item: PushHandoutItemInput,
): Promise<{ ok: boolean; mode: 'official' | 'custom' | 'failed'; message?: string }> {
  const name = item.name.trim();
  if (!name) return { ok: false, mode: 'failed', message: 'Item name is required' };

  const source = (item.source ?? '').trim().toLowerCase();
  const treatAsCustom = item.isCustom
    || !source
    || source === 'custom'
    || source === 'd&d beyond homebrew';

  try {
    if (!treatAsCustom) {
      const definitionId = await resolveDefinitionId(cobalt, item);
      if (definitionId) {
        const ok = await pushOfficialItem(cobalt, characterId, definitionId);
        if (ok) return { ok: true, mode: 'official' };
      }
    }

    const ok = await pushCustomItem(cobalt, characterId, item);
    if (ok) return { ok: true, mode: 'custom' };

    return {
      ok: false,
      mode: 'failed',
      message: 'D&D Beyond rejected the inventory update — add the item manually on your character sheet.',
    };
  } catch (err) {
    return {
      ok: false,
      mode: 'failed',
      message: err instanceof Error ? err.message : 'Inventory push failed',
    };
  }
}

export function handoutItemMetaToPushInput(
  meta: HandoutItemMeta | null,
  title: string,
  content?: string | null,
): PushHandoutItemInput {
  return {
    name: meta?.name?.trim() || title,
    description: content ?? undefined,
    itemType: meta?.itemType,
    rarity: meta?.rarity,
    source: meta?.source,
    isCustom: meta?.isCustom,
    ddbDefinitionId: meta?.ddbDefinitionId ?? undefined,
  };
}
