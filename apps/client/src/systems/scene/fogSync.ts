import { getSocket } from '@/lib/socket';
import { useSessionStore } from '@/store/sessionStore';
import { useMapStore } from '@/systems/map/store/mapStore';
import {
  getPersistSessionId,
  loadFogCells,
  persistFogLocal,
} from './sessionPersistence';

let pendingFogServerSync: ReturnType<typeof setTimeout> | null = null;

export function fogDataJson(): string {
  return JSON.stringify([...useMapStore.getState().revealedCells]);
}

export function parseFogCells(fogData: string): Set<string> {
  try {
    return new Set(JSON.parse(fogData) as string[]);
  } catch {
    return new Set();
  }
}

export function applyFogData(fogData: string, options?: { persist?: boolean }) {
  useMapStore.getState().setRevealedCells(parseFogCells(fogData), options);
}

/** Save fog locally immediately; debounce a live socket push to other clients. */
export function persistFogScene(options?: { pushServer?: boolean; sessionId?: string | null }) {
  const sessionId = options?.sessionId ?? getPersistSessionId();
  if (!sessionId) return;

  const fogData = fogDataJson();
  persistFogLocal(sessionId, fogData);

  if (options?.pushServer === false) return;

  if (pendingFogServerSync) clearTimeout(pendingFogServerSync);
  pendingFogServerSync = setTimeout(() => {
    pendingFogServerSync = null;
    const sid = getPersistSessionId();
    if (!sid) return;
    const data = fogDataJson();
    persistFogLocal(sid, data);
    getSocket().emit('map:fogUpdate', { sessionId: sid, fogData: data });
  }, 400);
}

/** Flush fog to local storage + server immediately (page unload / GM sync). */
export function flushFogScene(sessionId?: string | null) {
  const sid = sessionId ?? getPersistSessionId();
  if (!sid) return;

  if (pendingFogServerSync) {
    clearTimeout(pendingFogServerSync);
    pendingFogServerSync = null;
  }

  const fogData = fogDataJson();
  persistFogLocal(sid, fogData);

  if (useSessionStore.getState().myRole === 'GM') {
    getSocket().emit('fog:sync', { sessionId: sid, fogData });
  } else {
    getSocket().emit('map:fogUpdate', { sessionId: sid, fogData });
  }
}

/**
 * Restore fog on session entry — per-user local storage is authoritative when it has data.
 */
export function restoreFogFromLocal(sessionId: string): void {
  const local = loadFogCells(sessionId);
  useMapStore.getState().setRevealedCells(local, { persist: false });
}

/** Merge server snapshot on join; local wins when it has more reveals. */
export function hydrateFogFromServer(fogData: string, sessionId?: string | null) {
  const sid = sessionId ?? getPersistSessionId();
  const server = parseFogCells(fogData);
  const local = sid ? loadFogCells(sid) : new Set<string>();
  const inMemory = useMapStore.getState().revealedCells;

  let merged: Set<string>;
  if (local.size > 0) {
    merged = new Set([...local, ...inMemory]);
  } else if (server.size > 0) {
    merged = new Set([...server, ...inMemory]);
  } else {
    merged = new Set([...inMemory]);
  }

  const json = JSON.stringify([...merged]);
  useMapStore.getState().setRevealedCells(merged, { persist: false });
  if (sid) persistFogLocal(sid, json);

  if (sid && merged.size > server.size && useSessionStore.getState().myRole === 'GM') {
    getSocket().emit('fog:sync', { sessionId: sid, fogData: json });
  }
}

/** Broadcast current revealed cells to other clients (and server cache). */
export function emitFogUpdate() {
  persistFogScene({ pushServer: true });
}

/** GM pushes full fog snapshot when a player joins. */
export function emitFogSync() {
  flushFogScene();
}
