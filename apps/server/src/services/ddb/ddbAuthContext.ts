import { cobaltCacheId, ddbAuthHeaders, getBearerToken, normalizeCobaltToken } from './cobaltAuth';
import { userIdFromBearer } from './campaigns';

export interface DdbAuthContext {
  cobalt: string;
  cacheId: string;
  bearer: string;
  ddbUserId?: number;
}

export async function getDdbAuthContext(cobalt: string): Promise<DdbAuthContext | null> {
  const token = normalizeCobaltToken(cobalt);
  if (!token) return null;
  const cacheId = cobaltCacheId(token);
  const bearer = await getBearerToken(cacheId, token);
  if (!bearer) return null;
  const ddbUserId = userIdFromBearer(bearer) ?? undefined;
  return { cobalt: token, cacheId, bearer, ddbUserId };
}

export function authHeaders(ctx: DdbAuthContext, opts?: { characterId?: number }): Record<string, string> {
  return ddbAuthHeaders(ctx.cobalt, ctx.bearer, {
    characterId: opts?.characterId,
    ddbUserId: ctx.ddbUserId,
  });
}
