import { getSocket } from '@/lib/socket';
import { useSessionStore } from '@/store/sessionStore';
import { useMapStore } from '@/systems/map/store/mapStore';
import {
  getPersistSessionId,
  loadFogCells,
  persistFogLocal,
} from './sessionPersistence';
import {
  fogDeltaFromPrevious,
  mergeFogIntoCells,
  parseFogCellSet,
  shouldSendFogDelta,
} from './fogMerge';
import type { FogUpdatePayload } from '@grimoire/shared';

let pendingFogServerSync: ReturnType<typeof setTimeout> | null = null;
let lastPushedCells: Set<string> | null = null;

export function fogDataJson(): string {
  return JSON.stringify([...useMapStore.getState().revealedCells]);
}

export function parseFogCells(fogData: string): Set<string> {
  return parseFogCellSet(fogData);
}

export function applyFogPayload(
  payload: Pick<FogUpdatePayload, 'fogData' | 'added' | 'removed'>,
  options?: { persist?: boolean },
) {
  const merged = mergeFogIntoCells(useMapStore.getState().revealedCells, payload);
  useMapStore.getState().setRevealedCells(merged, options);
}

export function applyFogData(fogData: string, options?: { persist?: boolean }) {
  applyFogPayload({ fogData }, options);
}

function pushFogToServer(sessionId: string, cells: Set<string>) {
  if (useSessionStore.getState().myRole !== 'GM') return;

  const fullJson = JSON.stringify([...cells]);
  persistFogLocal(sessionId, fullJson);

  const previous = lastPushedCells ?? new Set<string>();
  const { added, removed } = fogDeltaFromPrevious(cells, previous);

  if (shouldSendFogDelta(added, removed, fullJson)) {
    if (getSocket().connected) {
      getSocket().emit('map:fogUpdate', { sessionId, added, removed });
    }
  } else if (getSocket().connected) {
    getSocket().emit('map:fogUpdate', { sessionId, fogData: fullJson });
  }
  lastPushedCells = new Set(cells);
}

/** Save fog locally immediately; debounce socket push (delta when possible). */
export function persistFogScene(options?: { pushServer?: boolean; sessionId?: string | null }) {
  const sessionId = options?.sessionId ?? getPersistSessionId();
  if (!sessionId) return;

  const cells = useMapStore.getState().revealedCells;
  const fogData = JSON.stringify([...cells]);
  persistFogLocal(sessionId, fogData);

  if (options?.pushServer === false) return;

  if (pendingFogServerSync) clearTimeout(pendingFogServerSync);
  pendingFogServerSync = setTimeout(() => {
    pendingFogServerSync = null;
    const sid = getPersistSessionId();
    if (!sid) return;
    pushFogToServer(sid, useMapStore.getState().revealedCells);
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

  const cells = useMapStore.getState().revealedCells;
  const fogData = JSON.stringify([...cells]);
  persistFogLocal(sid, fogData);
  lastPushedCells = new Set(cells);

  if (useSessionStore.getState().myRole === 'GM' && getSocket().connected) {
    getSocket().emit('fog:sync', { sessionId: sid, fogData });
  }
}

/**
 * Restore fog on session entry — per-user local storage is authoritative when it has data.
 */
export function restoreFogFromLocal(sessionId: string): void {
  const local = loadFogCells(sessionId);
  useMapStore.getState().setRevealedCells(local, { persist: false });
  lastPushedCells = new Set(local);
}

/** Merge server snapshot on join; preserve local reveals when server sends empty/stale data. */
export function hydrateFogFromServer(fogData: string, sessionId?: string | null) {
  const sid = sessionId ?? getPersistSessionId();
  const server = parseFogCells(fogData);
  const local = sid ? loadFogCells(sid) : new Set<string>();
  const inMemory = useMapStore.getState().revealedCells;
  const isGM = useSessionStore.getState().myRole === 'GM';

  if (isGM && server.size === 0 && (local.size > 0 || inMemory.size > 0)) {
    return;
  }

  let merged: Set<string>;
  if (local.size > 0) {
    merged = new Set([...local, ...inMemory, ...server]);
  } else if (server.size > 0) {
    merged = new Set([...server, ...inMemory]);
  } else {
    merged = new Set([...inMemory]);
  }

  const json = JSON.stringify([...merged]);
  useMapStore.getState().setRevealedCells(merged, { persist: false });
  if (sid) persistFogLocal(sid, json);
  lastPushedCells = new Set(merged);

  if (sid && merged.size > server.size && useSessionStore.getState().myRole === 'GM' && getSocket().connected) {
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

/** Reset delta baseline after loading a full snapshot from server. */
export function resetFogPushBaseline(cells?: Set<string>) {
  lastPushedCells = cells ? new Set(cells) : new Set(useMapStore.getState().revealedCells);
}
