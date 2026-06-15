import type { Item } from './types';
import { sanitizePersistedItems } from './mergeSceneItems';
import { useSessionStore } from '@/store/sessionStore';
import type { Combatant } from '@/systems/map/store/initiativeStore';

const ITEMS_PREFIX = 'grimoire:items:';
const FOG_PREFIX = 'grimoire:fog:';
const INITIATIVE_PREFIX = 'grimoire:initiative:';
const DELETED_PREFIX = 'grimoire:deleted:';
const VIEWPORT_PREFIX = 'grimoire:viewport:';

export interface PersistedViewport {
  x: number;
  y: number;
  scale: number;
}

/** Session id from store or URL — works before SessionPage finishes hydrating. */
export function getPersistSessionId(): string | null {
  const fromStore = useSessionStore.getState().sessionId;
  if (fromStore) return fromStore;
  const m = window.location.pathname.match(/\/sessions\/([^/]+)/);
  return m?.[1] ?? null;
}

/** Scope local keys per user so accounts on the same browser do not share scene data. */
function scopedKey(prefix: string, sessionId: string): string {
  const userId = useSessionStore.getState().myUserId;
  if (userId) return `${prefix}${userId}:${sessionId}`;
  return `${prefix}${sessionId}`;
}

export function persistItemsLocal(sessionId: string, items: Item[]): void {
  try {
    localStorage.setItem(scopedKey(ITEMS_PREFIX, sessionId), JSON.stringify(items));
  } catch {
    /* quota / private mode */
  }
}

export function loadItemsLocal(sessionId: string): Item[] | null {
  try {
    const userId = useSessionStore.getState().myUserId;
    const keys = userId
      ? [scopedKey(ITEMS_PREFIX, sessionId), `${ITEMS_PREFIX}${sessionId}`]
      : [`${ITEMS_PREFIX}${sessionId}`];
    for (const key of keys) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const list = JSON.parse(raw) as Item[];
      if (!Array.isArray(list) || list.length === 0) continue;
      return sanitizePersistedItems(list);
    }
    return null;
  } catch {
    return null;
  }
}

function parseFogJson(raw: string | null): Set<string> {
  if (!raw) return new Set<string>();
  try {
    const list = JSON.parse(raw) as string[];
    return new Set(Array.isArray(list) ? list : []);
  } catch {
    return new Set<string>();
  }
}

export function persistFogLocal(sessionId: string, fogData: string): void {
  const key = scopedKey(FOG_PREFIX, sessionId);
  try {
    localStorage.setItem(key, fogData);
  } catch {
    /* quota — sessionStorage fallback below */
  }
  try {
    sessionStorage.setItem(key, fogData);
  } catch {
    /* quota / private mode */
  }
}

export function persistFogCells(cells: Set<string>, sessionId?: string | null): void {
  const sid = sessionId ?? getPersistSessionId();
  if (!sid) return;
  persistFogLocal(sid, JSON.stringify([...cells]));
}

/** Merge localStorage + sessionStorage so a stale empty local entry never hides backup data. */
export function loadFogCells(sessionId: string): Set<string> {
  try {
    const userId = useSessionStore.getState().myUserId;
    const keys = userId
      ? [scopedKey(FOG_PREFIX, sessionId), `${FOG_PREFIX}${sessionId}`]
      : [`${FOG_PREFIX}${sessionId}`];
    let fromLocal = new Set<string>();
    let fromSession = new Set<string>();
    for (const key of keys) {
      const localPart = parseFogJson(localStorage.getItem(key));
      const sessionPart = parseFogJson(sessionStorage.getItem(key));
      if (localPart.size > fromLocal.size) fromLocal = localPart;
      if (sessionPart.size > fromSession.size) fromSession = sessionPart;
    }
    if (fromLocal.size === 0) return fromSession;
    if (fromSession.size === 0) return fromLocal;
    return new Set([...fromLocal, ...fromSession]);
  } catch {
    return new Set<string>();
  }
}

/** @deprecated Use loadFogCells — kept for callers expecting raw JSON string. */
export function loadFogLocal(sessionId: string): string | null {
  const cells = loadFogCells(sessionId);
  if (cells.size === 0) return null;
  return JSON.stringify([...cells]);
}

export interface PersistedInitiative {
  combatants: Combatant[];
  currentIndex: number;
  round: number;
  isActive: boolean;
}

export function persistInitiativeLocal(sessionId: string, state: PersistedInitiative): void {
  try {
    localStorage.setItem(scopedKey(INITIATIVE_PREFIX, sessionId), JSON.stringify(state));
  } catch {
    /* quota */
  }
}

export function loadDeletedIds(sessionId: string): Set<string> {
  try {
    const userId = useSessionStore.getState().myUserId;
    const keys = userId
      ? [scopedKey(DELETED_PREFIX, sessionId), `${DELETED_PREFIX}${sessionId}`]
      : [`${DELETED_PREFIX}${sessionId}`];
    let best = new Set<string>();
    for (const key of keys) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const list = JSON.parse(raw) as string[];
      const set = new Set(Array.isArray(list) ? list : []);
      if (set.size > best.size) best = set;
    }
    return best;
  } catch {
    return new Set();
  }
}

export function addDeletedIds(sessionId: string, ids: string[]): void {
  if (!ids.length) return;
  const set = loadDeletedIds(sessionId);
  for (const id of ids) set.add(id);
  try {
    localStorage.setItem(scopedKey(DELETED_PREFIX, sessionId), JSON.stringify([...set]));
  } catch {
    /* quota */
  }
}

export function persistViewportLocal(sessionId: string, viewport: PersistedViewport): void {
  try {
    localStorage.setItem(scopedKey(VIEWPORT_PREFIX, sessionId), JSON.stringify(viewport));
  } catch {
    /* quota */
  }
}

export function loadViewportLocal(sessionId: string): PersistedViewport | null {
  try {
    const raw = localStorage.getItem(scopedKey(VIEWPORT_PREFIX, sessionId));
    if (!raw) return null;
    const vp = JSON.parse(raw) as PersistedViewport;
    if (
      typeof vp.x === 'number'
      && typeof vp.y === 'number'
      && typeof vp.scale === 'number'
      && vp.scale > 0
    ) {
      return vp;
    }
    return null;
  } catch {
    return null;
  }
}

export function loadInitiativeLocal(sessionId: string): PersistedInitiative | null {
  try {
    const userId = useSessionStore.getState().myUserId;
    const keys = userId
      ? [scopedKey(INITIATIVE_PREFIX, sessionId), `${INITIATIVE_PREFIX}${sessionId}`]
      : [`${INITIATIVE_PREFIX}${sessionId}`];
    for (const key of keys) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      return JSON.parse(raw) as PersistedInitiative;
    }
    return null;
  } catch {
    return null;
  }
}
