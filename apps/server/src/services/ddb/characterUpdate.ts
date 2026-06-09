import {
  cobaltCacheId,
  ddbAuthHeaders,
  getBearerToken,
  invalidateBearer,
  normalizeCobaltToken,
} from './cobaltAuth';
import { DDB_URLS } from './config';
import { fetchRawCharacter } from './characterExtract';
import { extractVitals } from './vitalsExtract';

const HP_UPDATE_URL = `${DDB_URLS.characterBase}/life/hp/damage-taken`;
const DEATH_SAVE_URL = `${DDB_URLS.characterBase}/life/death-saves`;

export interface DdbDeathSavesPayload {
  successes: number;
  failures: number;
  stabilized?: boolean;
}

async function requestDeathSaveUpdate(
  cobalt: string,
  characterId: number,
  deathSaves: DdbDeathSavesPayload,
  refreshBearer = false,
): Promise<Response> {
  const token = normalizeCobaltToken(cobalt);
  const cacheId = cobaltCacheId(token);
  if (refreshBearer) await invalidateBearer(cacheId);

  const bearer = await getBearerToken(cacheId, token);
  if (!bearer) return new Response(null, { status: 401 });

  return fetch(DEATH_SAVE_URL, {
    method: 'PUT',
    headers: {
      ...ddbAuthHeaders(token, bearer, { characterId }),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      characterId,
      successCount: Math.max(0, Math.min(3, deathSaves.successes)),
      failCount: Math.max(0, Math.min(3, deathSaves.failures)),
      isStabilized: Boolean(deathSaves.stabilized),
    }),
  });
}

async function requestHpUpdate(
  cobalt: string,
  characterId: number,
  body: { characterId: number; removedHitPoints: number; temporaryHitPoints: number },
  refreshBearer = false,
): Promise<Response> {
  const token = normalizeCobaltToken(cobalt);
  const cacheId = cobaltCacheId(token);
  if (refreshBearer) await invalidateBearer(cacheId);

  const bearer = await getBearerToken(cacheId, token);
  if (!bearer) return new Response(null, { status: 401 });

  return fetch(HP_UPDATE_URL, {
    method: 'PUT',
    headers: {
      ...ddbAuthHeaders(token, bearer, { characterId }),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

/** Best-effort HP push to D&D Beyond (unofficial API). */
export async function pushHpToDdb(
  cobalt: string,
  characterId: number,
  hp: number,
  tempHp: number,
): Promise<boolean> {
  try {
    const raw = await fetchRawCharacter(cobalt, characterId);
    const { maxHp } = extractVitals(raw);
    const removedHitPoints = Math.max(0, Math.min(maxHp, maxHp - hp));

    const body = {
      characterId,
      removedHitPoints,
      temporaryHitPoints: Math.max(0, tempHp),
    };

    let res = await requestHpUpdate(cobalt, characterId, body);
    if (res.status === 401 || res.status === 403) {
      res = await requestHpUpdate(cobalt, characterId, body, true);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn(`[DDB] HP push failed (${res.status}): ${text.slice(0, 300)}`);
      return false;
    }

    const json = (await res.json().catch(() => null)) as { success?: boolean; message?: string } | null;
    if (json && 'success' in json && json.success === false) {
      console.warn(`[DDB] HP push rejected: ${json.message ?? 'unknown error'}`);
      return false;
    }

    return true;
  } catch (err) {
    console.warn('[DDB] HP push error:', err instanceof Error ? err.message : err);
    return false;
  }
}

/** Best-effort death save push to D&D Beyond (unofficial API). */
export async function pushDeathSavesToDdb(
  cobalt: string,
  characterId: number,
  deathSaves: DdbDeathSavesPayload,
): Promise<boolean> {
  try {
    let res = await requestDeathSaveUpdate(cobalt, characterId, deathSaves);
    if (res.status === 401 || res.status === 403) {
      res = await requestDeathSaveUpdate(cobalt, characterId, deathSaves, true);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn(`[DDB] death save push failed (${res.status}): ${text.slice(0, 300)}`);
      return false;
    }

    const json = (await res.json().catch(() => null)) as { success?: boolean; message?: string } | null;
    if (json && 'success' in json && json.success === false) {
      console.warn(`[DDB] death save push rejected: ${json.message ?? 'unknown error'}`);
      return false;
    }

    return true;
  } catch (err) {
    console.warn('[DDB] death save push error:', err instanceof Error ? err.message : err);
    return false;
  }
}
