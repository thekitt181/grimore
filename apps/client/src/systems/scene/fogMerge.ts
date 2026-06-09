import type { FogUpdatePayload } from '@grimoire/shared';

export function parseFogCellSet(fogData: string): Set<string> {
  try {
    return new Set(JSON.parse(fogData) as string[]);
  } catch {
    return new Set();
  }
}

/** Apply a full or delta fog payload onto a cell set. */
export function mergeFogIntoCells(
  current: Set<string>,
  payload: Pick<FogUpdatePayload, 'fogData' | 'added' | 'removed'>,
): Set<string> {
  if (payload.fogData != null && payload.fogData.length > 0) {
    return parseFogCellSet(payload.fogData);
  }
  if (payload.added?.length || payload.removed?.length) {
    const next = new Set(current);
    for (const k of payload.removed ?? []) next.delete(k);
    for (const k of payload.added ?? []) next.add(k);
    return next;
  }
  if (payload.fogData != null) {
    return parseFogCellSet(payload.fogData);
  }
  return current;
}

export function fogDeltaFromPrevious(
  current: Set<string>,
  previous: Set<string>,
): { added: string[]; removed: string[] } {
  const added: string[] = [];
  const removed: string[] = [];
  for (const k of current) {
    if (!previous.has(k)) added.push(k);
  }
  for (const k of previous) {
    if (!current.has(k)) removed.push(k);
  }
  return { added, removed };
}

/** Prefer delta when it is materially smaller than a full JSON array. */
export function shouldSendFogDelta(
  added: string[],
  removed: string[],
  fullJson: string,
): boolean {
  if (added.length === 0 && removed.length === 0) return false;
  const deltaJson = JSON.stringify({ added, removed });
  return deltaJson.length < fullJson.length * 0.85;
}
