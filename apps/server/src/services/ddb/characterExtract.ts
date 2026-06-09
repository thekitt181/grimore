import type { GrimoireCharacter } from '@grimoire/shared';
import {
  cobaltCacheId,
  ddbAuthHeaders,
  getBearerToken,
  invalidateBearer,
  normalizeCobaltToken,
} from './cobaltAuth';
import { characterUrl } from './config';
import { normalizeCharacter } from './characterNormalizer';

async function requestCharacter(
  cobalt: string,
  characterId: number,
  refreshBearer = false,
): Promise<Response> {
  const token = normalizeCobaltToken(cobalt);
  const cacheId = cobaltCacheId(token);
  if (refreshBearer) await invalidateBearer(cacheId);

  const bearer = await getBearerToken(cacheId, token);
  if (!bearer) throw new Error('Invalid or expired D&D Beyond session — re-link your Cobalt token');

  return fetch(characterUrl(characterId), {
    headers: ddbAuthHeaders(token, bearer, { characterId }),
  });
}

async function enrichAccessError(cobalt: string, characterId: number, base: string): Promise<string> {
  try {
    const { fetchDdbCharacterList } = await import('./campaigns');
    const list = await fetchDdbCharacterList(cobalt);
    if (!list.length) return base;
    const match = list.find((c) => c.ddbCharacterId === characterId);
    if (match) return base;
    const samples = list
      .slice(0, 6)
      .map((c) => `${c.name} → ID ${c.ddbCharacterId}`)
      .join('; ');
    return `${base} Your linked account can import: ${samples}. Pick one from the list instead of typing an ID manually.`;
  } catch {
    return base;
  }
}

export async function fetchRawCharacter(
  cobalt: string,
  characterId: number,
): Promise<Record<string, unknown>> {
  let res = await requestCharacter(cobalt, characterId);
  if (res.status === 401 || res.status === 403) {
    res = await requestCharacter(cobalt, characterId, true);
  }

  const json = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    data?: Record<string, unknown>;
    message?: string;
  };

  if (!res.ok) {
    if (res.status === 403) {
      const base =
        json.message ??
        `Cannot access character ${characterId}. Use the ID from your sheet URL (dndbeyond.com/characters/XXXXXXXX), not avatar image filenames.`;
      throw new Error(await enrichAccessError(cobalt, characterId, base));
    }
    if (res.status === 404) {
      const base = `Character ${characterId} was not found on D&D Beyond`;
      throw new Error(await enrichAccessError(cobalt, characterId, base));
    }
    throw new Error(json.message ?? `DDB character fetch failed (${res.status})`);
  }

  if (!json.success || !json.data) {
    throw new Error(json.message ?? 'Failed to load character');
  }
  return json.data;
}

export async function extractCharacter(
  cobalt: string,
  characterId: number,
): Promise<GrimoireCharacter> {
  const raw = await fetchRawCharacter(cobalt, characterId);
  return normalizeCharacter(raw, characterId);
}
