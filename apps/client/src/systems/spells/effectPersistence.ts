import type { SpellEffectSyncPayload } from '@grimoire/shared';

const PREFIX = 'grimoire:effects:';

/** Session-scoped key — spell effects are shared table state, not per-user. */
function sessionKey(sessionId: string): string {
  return `${PREFIX}${sessionId}`;
}

function readLegacyKeys(sessionId: string): string[] {
  const canonical = sessionKey(sessionId);
  const legacy: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(PREFIX) || key === canonical) continue;
    if (key.endsWith(`:${sessionId}`) || key.includes(`:${sessionId}:`)) {
      legacy.push(key);
    }
  }
  return legacy;
}

export function persistSpellEffectsLocal(sessionId: string, payload: SpellEffectSyncPayload): void {
  try {
    const key = sessionKey(sessionId);
    localStorage.setItem(key, JSON.stringify(payload));
    for (const legacy of readLegacyKeys(sessionId)) {
      if (legacy !== key) localStorage.removeItem(legacy);
    }
  } catch {
    /* quota */
  }
}

export function loadSpellEffectsLocal(sessionId: string): SpellEffectSyncPayload | null {
  try {
    const key = sessionKey(sessionId);
    let raw = localStorage.getItem(key);

    if (!raw) {
      for (const legacy of readLegacyKeys(sessionId)) {
        const candidate = localStorage.getItem(legacy);
        if (candidate) {
          raw = candidate;
          localStorage.setItem(key, candidate);
          localStorage.removeItem(legacy);
          break;
        }
      }
    }

    if (!raw) return null;
    const parsed = JSON.parse(raw) as SpellEffectSyncPayload;
    return {
      ...parsed,
      sessionId,
      effects: parsed.effects.filter((e) => !e.ended),
    };
  } catch {
    return null;
  }
}

export function clearSpellEffectsLocal(sessionId: string): void {
  try {
    localStorage.removeItem(sessionKey(sessionId));
    for (const legacy of readLegacyKeys(sessionId)) {
      localStorage.removeItem(legacy);
    }
  } catch {
    /* ignore */
  }
}
