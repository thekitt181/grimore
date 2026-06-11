import crypto from 'crypto';
import { redis, safeRedis } from '../../lib/redis';
import { DDB_URLS } from './config';

const BEARER_TTL = 60 * 60 * 4; // 4 hours

export function cobaltCacheId(cobalt: string): string {
  return crypto.createHash('sha256').update(cobalt).digest('hex');
}

export function characterCacheKey(cobalt: string, characterId: number): string {
  return crypto.createHash('sha256').update(`${characterId}:${cobalt}`).digest('hex');
}

/** Strip accidental cookie-name prefix or quotes from pasted values. */
export function normalizeCobaltToken(raw: string): string {
  let t = raw.trim();
  if (t.toLowerCase().startsWith('cobaltsession=')) {
    t = t.slice('cobaltsession='.length).trim();
  }
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    t = t.slice(1, -1).trim();
  }
  return t;
}

export async function invalidateBearer(cacheId: string): Promise<void> {
  await safeRedis(undefined, () => redis.del(`ddb:bearer:${cacheId}`));
}

/** Headers DDB expects for character-service + site API calls. */
export function ddbAuthHeaders(
  cobalt: string,
  bearer: string,
  opts?: { characterId?: number; ddbUserId?: number },
): Record<string, string> {
  const token = normalizeCobaltToken(cobalt);
  const cookies = [`CobaltSession=${token}`];
  if (opts?.ddbUserId) cookies.push(`User.ID=${opts.ddbUserId}`);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${bearer}`,
    Cookie: cookies.join('; '),
    Accept: 'application/json',
    'Accept-Encoding': 'gzip, deflate, br',
    'User-Agent': 'Foundry VTT Character Integrator',
    Origin: 'https://www.dndbeyond.com',
    Referer: 'https://www.dndbeyond.com/characters/build',
  };
  if (opts?.characterId) {
    headers.Referer = `https://www.dndbeyond.com/characters/${opts.characterId}`;
  }
  return headers;
}

export async function getBearerToken(
  cacheId: string,
  cobalt: string,
  ddbUserId?: number,
): Promise<string | null> {
  const token = normalizeCobaltToken(cobalt);
  if (!token) return null;

  const cached = await safeRedis<string | null>(null, () => redis.get(`ddb:bearer:${cacheId}`));
  if (cached) return cached;

  const cookieParts = [`CobaltSession=${token}`];
  if (ddbUserId) cookieParts.push(`User.ID=${ddbUserId}`);

  const res = await fetch(DDB_URLS.authService, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookieParts.join('; '),
    },
    body: '{}',
  });

  if (!res.ok) {
    console.warn(`[DDB] Auth service returned ${res.status}`);
    return null;
  }

  const data = (await res.json()) as { token?: string };
  const bearer = data.token;
  if (!bearer) return null;

  await safeRedis(undefined, () => redis.setex(`ddb:bearer:${cacheId}`, BEARER_TTL, bearer));
  return bearer;
}

export async function validateCobalt(cobalt: string): Promise<boolean> {
  const token = normalizeCobaltToken(cobalt);
  if (token.length < 10) return false;
  const cacheId = cobaltCacheId(token);
  const bearer = await getBearerToken(cacheId, token);
  return Boolean(bearer);
}
