import { getSessionFog, setSessionFog } from './redis';

function parseFogCellSet(fogData: string): Set<string> {
  try {
    return new Set(JSON.parse(fogData) as string[]);
  } catch {
    return new Set();
  }
}

/** Persist full or delta fog to Redis session cache. */
export async function persistSessionFogCache(
  sessionId: string,
  payload: { fogData?: string; added?: string[]; removed?: string[] },
): Promise<void> {
  if (payload.fogData != null) {
    await setSessionFog(sessionId, payload.fogData);
    return;
  }
  if (!payload.added?.length && !payload.removed?.length) return;

  const raw = await getSessionFog(sessionId);
  const cells = raw ? parseFogCellSet(raw) : new Set<string>();
  for (const k of payload.removed ?? []) cells.delete(k);
  for (const k of payload.added ?? []) cells.add(k);
  await setSessionFog(sessionId, JSON.stringify([...cells]));
}
