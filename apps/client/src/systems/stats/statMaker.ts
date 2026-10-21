/**
 * Adventure stats — one document per player (by user id) in localStorage.
 * Events relay over the session socket so DM + player docs stay aligned.
 * Not stored in the VTT database.
 */
import { create } from 'zustand';
import type { StatsDocSyncPayload, StatsEventPayload } from '@grimoire/shared';
import { getSocket } from '@/lib/socket';
import { useSessionStore } from '@/store/sessionStore';
import { useInitiativeStore } from '@/systems/map/store/initiativeStore';
import { useItemStore } from '@/systems/scene/store/itemStore';

const STORAGE_BY_ID = 'grimoire-statmaker:uid:';
const LEGACY_PREFIX = 'grimoire-statmaker:';

export type StatObjectEntry = {
  id: string;
  name: string;
  action: string;
  at: number;
  sessionId?: string;
};

export type StatCreatureEntry = {
  id: string;
  name: string;
  at: number;
  round?: number;
  sessionId?: string;
};

export type PlayerStatDoc = {
  userName: string;
  userId: string;
  createdAt: number;
  updatedAt: number;
  objectsInteracted: StatObjectEntry[];
  creaturesDefeated: StatCreatureEntry[];
  timesDowned: number;
  combatRounds: number;
  sessionsTouched: string[];
};

export type StatUserRef = { userId: string; userName: string };

/** Panel / download id for the party-wide rollup (not a real user). */
export const OVERALL_STATS_ID = '__overall__';

export type StatObjectEntryView = StatObjectEntry & { playerName?: string };
export type StatCreatureEntryView = StatCreatureEntry & { playerName?: string };

/** Aggregated view of all individual player docs (computed, not stored). */
export type OverallStatDoc = Omit<PlayerStatDoc, 'objectsInteracted' | 'creaturesDefeated'> & {
  userId: typeof OVERALL_STATS_ID;
  objectsInteracted: StatObjectEntryView[];
  creaturesDefeated: StatCreatureEntryView[];
  playerCount: number;
  playerNames: string[];
};

type StatMakerState = {
  /** All player docs known on this browser (keyed by userId). */
  docsById: Record<string, PlayerStatDoc>;
  /** Which player's doc the panel is showing. */
  activeUserId: string | null;
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  setActiveUserId: (userId: string) => void;
  ensureLocalDoc: () => PlayerStatDoc;
  ensurePlayerDoc: (ref: StatUserRef) => PlayerStatDoc;
  refreshFromStorage: () => void;
  listPlayers: () => StatUserRef[];
};

function safeFileStem(name: string): string {
  const s = name.trim().replace(/[^\w\-]+/g, '_').replace(/_+/g, '_');
  return s.slice(0, 48) || 'Player';
}

function isGenericPlayerLabel(name: string | null | undefined): boolean {
  const n = (name ?? '').trim().toLowerCase();
  return !n || n === 'player' || n === 'user' || n === 'guest';
}

let authDisplayName: string | null = null;

export function setStatMakerAuthUserName(name: string | null | undefined): void {
  const next = name?.trim() || null;
  if (next === authDisplayName) return;
  authDisplayName = next;
  useStatMakerStore.getState().ensureLocalDoc();
}

export function resolveLocalUserName(): StatUserRef {
  const { myUserId, connectedUsers } = useSessionStore.getState();
  const me = connectedUsers.find((u) => u.id === myUserId);
  const roomName = me?.username?.trim() || '';
  const authName = authDisplayName?.trim() || '';
  const userName = (
    (!isGenericPlayerLabel(authName) ? authName : null)
    || (!isGenericPlayerLabel(roomName) ? roomName : null)
    || authName
    || roomName
    || 'Player'
  ).trim();
  return { userId: myUserId || 'local', userName };
}

function storageKeyById(userId: string): string {
  return `${STORAGE_BY_ID}${userId}`;
}

function emptyDoc(userName: string, userId: string): PlayerStatDoc {
  const now = Date.now();
  return {
    userName,
    userId,
    createdAt: now,
    updatedAt: now,
    objectsInteracted: [],
    creaturesDefeated: [],
    timesDowned: 0,
    combatRounds: 0,
    sessionsTouched: [],
  };
}

function parseDoc(raw: string, fallbackName: string, userId: string): PlayerStatDoc | null {
  try {
    const parsed = JSON.parse(raw) as Partial<PlayerStatDoc>;
    const userName = (!isGenericPlayerLabel(parsed.userName) ? parsed.userName : null)
      || (!isGenericPlayerLabel(fallbackName) ? fallbackName : null)
      || parsed.userName
      || fallbackName
      || 'Player';
    return {
      ...emptyDoc(userName, userId),
      ...parsed,
      userName: String(userName).trim() || 'Player',
      userId,
      objectsInteracted: Array.isArray(parsed.objectsInteracted) ? parsed.objectsInteracted : [],
      creaturesDefeated: Array.isArray(parsed.creaturesDefeated) ? parsed.creaturesDefeated : [],
      sessionsTouched: Array.isArray(parsed.sessionsTouched) ? parsed.sessionsTouched : [],
      timesDowned: typeof parsed.timesDowned === 'number' ? parsed.timesDowned : 0,
      combatRounds: typeof parsed.combatRounds === 'number' ? parsed.combatRounds : 0,
    };
  } catch {
    return null;
  }
}

function readDocById(userId: string, preferredName?: string): PlayerStatDoc {
  try {
    const raw = localStorage.getItem(storageKeyById(userId));
    if (raw) {
      const doc = parseDoc(raw, preferredName || 'Player', userId);
      if (doc) return doc;
    }
  } catch {
    /* ok */
  }

  // Legacy keys: grimoire-statmaker:{Name}:{userId}
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(LEGACY_PREFIX) || key.startsWith(STORAGE_BY_ID)) continue;
      if (!key.endsWith(`:${userId}`)) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const nameFromKey = key.slice(LEGACY_PREFIX.length, key.length - userId.length - 1);
      const doc = parseDoc(raw, preferredName || nameFromKey || 'Player', userId);
      if (doc) {
        writeDoc(doc);
        try {
          localStorage.removeItem(key);
        } catch {
          /* ok */
        }
        return doc;
      }
    }
  } catch {
    /* ok */
  }

  return emptyDoc(preferredName || 'Player', userId);
}

function writeDoc(doc: PlayerStatDoc): void {
  doc.updatedAt = Date.now();
  try {
    localStorage.setItem(storageKeyById(doc.userId), JSON.stringify(doc));
  } catch {
    /* quota */
  }
}

function touchSession(doc: PlayerStatDoc): void {
  const sessionId = useSessionStore.getState().sessionId;
  if (!sessionId) return;
  if (!doc.sessionsTouched.includes(sessionId)) {
    doc.sessionsTouched = [...doc.sessionsTouched, sessionId].slice(-40);
  }
}

function scanAllStoredDocs(): Record<string, PlayerStatDoc> {
  const out: Record<string, PlayerStatDoc> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (key.startsWith(STORAGE_BY_ID)) {
        const userId = key.slice(STORAGE_BY_ID.length);
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const doc = parseDoc(raw, 'Player', userId);
        if (doc) out[userId] = doc;
        continue;
      }
      if (!key.startsWith(LEGACY_PREFIX)) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const rest = key.slice(LEGACY_PREFIX.length);
      const colon = rest.lastIndexOf(':');
      if (colon <= 0) continue;
      const userName = rest.slice(0, colon);
      const userId = rest.slice(colon + 1);
      if (!userId || out[userId]) continue;
      const doc = parseDoc(raw, userName, userId);
      if (doc) {
        out[userId] = doc;
        writeDoc(doc);
      }
    }
  } catch {
    /* ok */
  }
  return out;
}

function cloneDoc(doc: PlayerStatDoc): PlayerStatDoc {
  return {
    ...doc,
    objectsInteracted: [...doc.objectsInteracted],
    creaturesDefeated: [...doc.creaturesDefeated],
    sessionsTouched: [...doc.sessionsTouched],
  };
}

function isGmUserId(userId: string): boolean {
  const { connectedUsers, myUserId, myRole } = useSessionStore.getState();
  const u = connectedUsers.find((x) => x.id === userId);
  if (u?.role === 'GM') return true;
  return Boolean(myRole === 'GM' && myUserId && userId === myUserId);
}

function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Merge peer/stale docs into `into` (union entries; max counters). */
function mergeStatDocs(into: PlayerStatDoc, from: PlayerStatDoc): PlayerStatDoc {
  const objects = [...into.objectsInteracted];
  const seenObj = new Set(objects.map((o) => o.id));
  for (const o of from.objectsInteracted) {
    if (seenObj.has(o.id)) continue;
    seenObj.add(o.id);
    objects.push(o);
  }
  objects.sort((a, b) => b.at - a.at);

  const creatures = [...into.creaturesDefeated];
  const seenCr = new Set(creatures.map((c) => c.id));
  for (const c of from.creaturesDefeated) {
    if (seenCr.has(c.id)) continue;
    seenCr.add(c.id);
    creatures.push(c);
  }
  creatures.sort((a, b) => b.at - a.at);

  const sessions = new Set([...into.sessionsTouched, ...from.sessionsTouched]);
  const userName = !isGenericPlayerLabel(into.userName) ? into.userName : from.userName;
  return {
    ...into,
    userName,
    objectsInteracted: objects.slice(0, 200),
    creaturesDefeated: creatures.slice(0, 200),
    timesDowned: Math.max(into.timesDowned, from.timesDowned),
    combatRounds: Math.max(into.combatRounds, from.combatRounds),
    sessionsTouched: [...sessions].slice(-40),
    createdAt: Math.min(into.createdAt, from.createdAt),
    updatedAt: Math.max(into.updatedAt, from.updatedAt),
  };
}

function removeStoredDoc(userId: string): void {
  try {
    localStorage.removeItem(storageKeyById(userId));
  } catch {
    /* ok */
  }
}

export const useStatMakerStore = create<StatMakerState>((set, get) => ({
  docsById: {},
  activeUserId: null,
  panelOpen: false,
  setPanelOpen: (panelOpen) => set({ panelOpen }),
  setActiveUserId: (userId) => set({ activeUserId: userId }),

  ensurePlayerDoc: (ref) => {
    const name = ref.userName.trim() || 'Player';
    const id = ref.userId || 'local';
    const existing = get().docsById[id];
    if (existing) {
      if (!isGenericPlayerLabel(name) && existing.userName !== name) {
        const updated = { ...existing, userName: name };
        writeDoc(updated);
        set((s) => ({ docsById: { ...s.docsById, [id]: updated } }));
        return updated;
      }
      return existing;
    }
    let doc = readDocById(id, name);
    if (!isGenericPlayerLabel(name)) doc = { ...doc, userName: name };
    writeDoc(doc);
    set((s) => ({
      docsById: { ...s.docsById, [id]: doc },
      activeUserId: s.activeUserId ?? id,
    }));
    return doc;
  },

  ensureLocalDoc: () => {
    const me = resolveLocalUserName();
    const doc = get().ensurePlayerDoc(me);
    set((s) => ({ activeUserId: s.activeUserId ?? me.userId }));
    return doc;
  },

  refreshFromStorage: () => {
    const scanned = scanAllStoredDocs();
    const { connectedUsers, myUserId, myRole } = useSessionStore.getState();
    const me = resolveLocalUserName();
    let next = { ...scanned };
    for (const u of connectedUsers) {
      if (u.role === 'GM') continue;
      if (!next[u.id]) {
        next[u.id] = readDocById(u.id, u.username);
      } else if (!isGenericPlayerLabel(u.username) && next[u.id]!.userName !== u.username) {
        next[u.id] = { ...next[u.id]!, userName: u.username };
        writeDoc(next[u.id]!);
      }
    }
    if (myRole !== 'GM' && !next[me.userId]) {
      next[me.userId] = readDocById(me.userId, me.userName);
    }

    // Collapse stale docs that share a display name with a live connected player.
    const liveByName = new Map<string, string>();
    for (const u of connectedUsers) {
      if (u.role === 'GM') continue;
      const key = nameKey(u.username);
      if (key) liveByName.set(key, u.id);
    }
    for (const doc of Object.values(next)) {
      if (isGmUserId(doc.userId)) continue;
      const liveId = liveByName.get(nameKey(doc.userName));
      if (!liveId || liveId === doc.userId) continue;
      const liveDoc = next[liveId] ?? readDocById(liveId, doc.userName);
      const merged = mergeStatDocs(liveDoc, doc);
      writeDoc(merged);
      removeStoredDoc(doc.userId);
      delete next[doc.userId];
      next[liveId] = merged;
    }

    // Drop GM docs from the roster view (storage keys left alone).
    next = Object.fromEntries(
      Object.entries(next).filter(([id]) => !isGmUserId(id)),
    );

    set((s) => ({
      docsById: next,
      activeUserId:
        s.activeUserId === OVERALL_STATS_ID
        || (s.activeUserId && next[s.activeUserId])
          ? s.activeUserId
          : (myRole === 'GM' ? OVERALL_STATS_ID : me.userId),
    }));
  },

  listPlayers: () => {
    const { docsById } = get();
    const { connectedUsers, myUserId, myRole } = useSessionStore.getState();
    const me = resolveLocalUserName();

    // One tab per display name; prefer the currently connected user id.
    const byName = new Map<string, StatUserRef>();
    const connectedIds = new Set(connectedUsers.map((u) => u.id));

    function consider(ref: StatUserRef): void {
      if (!ref.userId || isGmUserId(ref.userId)) return;
      const key = nameKey(ref.userName) || ref.userId;
      const prev = byName.get(key);
      if (!prev) {
        byName.set(key, ref);
        return;
      }
      const refLive = connectedIds.has(ref.userId);
      const prevLive = connectedIds.has(prev.userId);
      if (refLive && !prevLive) byName.set(key, ref);
      else if (refLive === prevLive && !isGenericPlayerLabel(ref.userName)) byName.set(key, ref);
    }

    if (myRole !== 'GM') consider(me);

    for (const u of connectedUsers) {
      if (u.role === 'GM') continue;
      if (myRole === 'GM' || u.id === myUserId) {
        consider({
          userId: u.id,
          userName: !isGenericPlayerLabel(u.username)
            ? u.username
            : (docsById[u.id]?.userName || u.username || 'Player'),
        });
      }
    }

    for (const doc of Object.values(docsById)) {
      if (isGmUserId(doc.userId)) continue;
      if (myRole === 'GM' || doc.userId === myUserId) {
        consider({
          userId: doc.userId,
          userName: !isGenericPlayerLabel(doc.userName) ? doc.userName : 'Player',
        });
      }
    }

    return [...byName.values()].sort((a, b) => a.userName.localeCompare(b.userName));
  },
}));

/**
 * Stats only belong on player accounts — never the DM (Idle G / GM session user).
 * Returns null when the target would be the GM.
 * Prefer the live connected PLAYER id when the display name matches (fixes DM vs player id drift).
 */
export function playerStatTarget(ref: StatUserRef | null | undefined): StatUserRef | null {
  if (!ref?.userId && !ref?.userName) return null;
  const { connectedUsers, myUserId, myRole } = useSessionStore.getState();

  const byId = ref.userId
    ? connectedUsers.find((u) => u.id === ref.userId)
    : undefined;
  if (byId?.role === 'GM') return null;
  if (ref.userId && isGmUserId(ref.userId)) return null;

  const wantName = nameKey(
    (!isGenericPlayerLabel(ref.userName) ? ref.userName : null)
    || byId?.username
    || '',
  );

  // Prefer this client's own id when the event is about me (same username).
  if (myRole === 'PLAYER' && myUserId) {
    const me = connectedUsers.find((u) => u.id === myUserId);
    if (me && wantName && nameKey(me.username) === wantName) {
      return { userId: myUserId, userName: me.username };
    }
  }

  // Prefer any connected PLAYER with the same display name.
  if (wantName) {
    const live = connectedUsers.find(
      (u) => u.role === 'PLAYER' && nameKey(u.username) === wantName,
    );
    if (live) return { userId: live.id, userName: live.username };
  }

  if (byId && byId.role !== 'GM') {
    return { userId: byId.id, userName: byId.username };
  }

  if (!ref.userId || isGmUserId(ref.userId)) return null;
  return {
    userId: ref.userId,
    userName: (!isGenericPlayerLabel(ref.userName) ? ref.userName : null)
      || byId?.username
      || 'Player',
  };
}

/** Prefer token.ownerId; never falls back to the DM account. */
export function resolveTokenStatUser(
  ownerId: string | null | undefined,
  fallbackName?: string,
): StatUserRef | null {
  const id = ownerId?.trim();
  if (!id) return null;
  return playerStatTarget(resolveStatUserRef(id, fallbackName));
}

function pushDocSync(doc: PlayerStatDoc, replace = false): void {
  const sessionId = useSessionStore.getState().sessionId;
  if (!sessionId) return;
  const payload: StatsDocSyncPayload = {
    sessionId,
    userId: doc.userId,
    userName: doc.userName,
    ...(replace ? { replace: true } : {}),
    doc: {
      userName: doc.userName,
      userId: doc.userId,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      objectsInteracted: doc.objectsInteracted,
      creaturesDefeated: doc.creaturesDefeated,
      timesDowned: doc.timesDowned,
      combatRounds: doc.combatRounds,
      sessionsTouched: doc.sessionsTouched,
    },
  };
  try {
    getSocket().emit('stats:doc', payload);
  } catch {
    /* offline */
  }
}

/** Merge or replace a peer's player doc into the canonical local doc (by username). */
export function mergePeerStatDoc(remote: PlayerStatDoc, replace = false): void {
  const ref = playerStatTarget({ userId: remote.userId, userName: remote.userName });
  if (!ref) return;
  const store = useStatMakerStore.getState();
  if (replace) {
    const wiped: PlayerStatDoc = {
      ...emptyDoc(ref.userName, ref.userId),
      ...remote,
      userId: ref.userId,
      userName: ref.userName,
      updatedAt: Date.now(),
    };
    writeDoc(wiped);
    useStatMakerStore.setState((s) => ({
      docsById: { ...s.docsById, [wiped.userId]: wiped },
    }));
    return;
  }
  const base = store.ensurePlayerDoc(ref);
  const merged = mergeStatDocs(base, { ...remote, userId: ref.userId, userName: ref.userName });
  writeDoc(merged);
  useStatMakerStore.setState((s) => ({
    docsById: { ...s.docsById, [merged.userId]: merged },
  }));
}

/** Push every known player doc to peers (no request echo). */
export function pushAllStatDocs(): void {
  const { docsById, listPlayers } = useStatMakerStore.getState();
  for (const p of listPlayers()) {
    const doc = docsById[p.userId];
    if (doc && !isGmUserId(doc.userId)) pushDocSync(doc);
  }
}

/** Ask peers to push their docs, then push ours. */
export function requestStatDocSync(): void {
  const sessionId = useSessionStore.getState().sessionId;
  if (sessionId) {
    try {
      getSocket().emit('stats:syncRequest', { sessionId, mode: 'push' });
    } catch {
      /* offline */
    }
  }
  pushAllStatDocs();
}

/**
 * Wipe all player stats locally.
 * @param broadcast When true (default), tell the whole session to clear too.
 */
export function clearAllPlayerStats(broadcast = true): void {
  const store = useStatMakerStore.getState();
  const players = store.listPlayers();
  const next: Record<string, PlayerStatDoc> = {};
  const wipedList: PlayerStatDoc[] = [];
  for (const p of players) {
    if (isGmUserId(p.userId)) continue;
    const wiped = emptyDoc(p.userName, p.userId);
    writeDoc(wiped);
    next[p.userId] = wiped;
    wipedList.push(wiped);
  }
  try {
    const drop: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(STORAGE_BY_ID) || key?.startsWith(LEGACY_PREFIX)) drop.push(key);
    }
    for (const key of drop) localStorage.removeItem(key);
    for (const doc of wipedList) writeDoc(doc);
  } catch {
    /* ok */
  }
  useStatMakerStore.setState((s) => ({
    docsById: next,
    activeUserId: s.activeUserId === OVERALL_STATS_ID
      ? OVERALL_STATS_ID
      : (next[s.activeUserId ?? ''] ? s.activeUserId : (players[0]?.userId ?? OVERALL_STATS_ID)),
  }));
  if (!broadcast) return;
  const sessionId = useSessionStore.getState().sessionId;
  if (sessionId) {
    try {
      getSocket().emit('stats:syncRequest', { sessionId, mode: 'clear-all' });
    } catch {
      /* offline */
    }
  }
  for (const doc of wipedList) pushDocSync(doc, true);
}

function emitRoundStatEvent(userId: string, userName: string, round: number): void {
  const sessionId = useSessionStore.getState().sessionId;
  if (!sessionId) return;
  try {
    getSocket().emit('stats:event', {
      sessionId,
      eventId: `rounds:${userId}:${round}`,
      kind: 'round' as const,
      userId,
      userName,
      at: Date.now(),
      round,
    });
  } catch {
    /* offline */
  }
}

/** Live initiative round while combat is active (0 otherwise). */
export function liveInitiativeCombatRounds(): number {
  const { isActive, round } = useInitiativeStore.getState();
  return isActive && round >= 1 ? round : 0;
}

/**
 * While combat is active, always show the live initiative round.
 * (Stored value can be a stale high-water from an older fight — never Math.max over it.)
 */
export function effectiveCombatRounds(doc: Pick<PlayerStatDoc, 'combatRounds'>): number {
  const live = liveInitiativeCombatRounds();
  if (live >= 1) return live;
  return doc.combatRounds;
}

/**
 * Set combatRounds on a player doc to the current initiative round (never the GM).
 * Overwrites higher stale values when a new combat is on a lower round.
 * When `deferNet` is true, skip socket emit (caller batches).
 */
function bumpCombatRoundsDoc(
  userId: string,
  userName: string,
  round: number,
  deferNet = false,
): PlayerStatDoc | null {
  if (!userId || round < 1) return null;
  if (isGmUserId(userId)) return null;

  const store = useStatMakerStore.getState();
  const base = store.ensurePlayerDoc({ userId, userName: userName || 'Player' });
  if (base.combatRounds === round) return base;
  const doc = cloneDoc(base);
  touchSession(doc);
  doc.combatRounds = round;
  writeDoc(doc);
  if (!deferNet) {
    useStatMakerStore.setState((s) => ({
      docsById: { ...s.docsById, [doc.userId]: doc },
    }));
    pushDocSync(doc);
  }
  return doc;
}

/**
 * Initiative round is source of truth — bump the player's combatRounds up to `round`
 * and relay so peers catch up.
 */
export function ensureCombatRoundsAtLeast(forUser: StatUserRef, round: number): void {
  if (round < 1 || !forUser.userId) return;
  const ref = playerStatTarget(forUser) ?? forUser;
  if (!ref.userId || isGmUserId(ref.userId)) return;
  const doc = bumpCombatRoundsDoc(ref.userId, ref.userName || 'Player', round);
  if (doc) emitRoundStatEvent(ref.userId, ref.userName || 'Player', round);
}

let pendingRoundSync: number | null = null;
let roundSyncScheduled = false;

function flushInitiativeRoundSync(initRound: number): void {
  if (initRound < 1) return;
  const { connectedUsers, myRole, myUserId } = useSessionStore.getState();
  const store = useStatMakerStore.getState();
  const seen = new Set<string>();
  const mutatedById: Record<string, PlayerStatDoc> = {};
  const emitIds = new Set<string>();

  const bump = (userId: string, userName: string) => {
    if (!userId || seen.has(userId)) return;
    if (isGmUserId(userId)) return;
    seen.add(userId);
    const before = store.docsById[userId]?.combatRounds;
    const doc = bumpCombatRoundsDoc(userId, userName, initRound, true);
    if (!doc) return;
    emitIds.add(userId);
    if (before !== initRound) mutatedById[doc.userId] = doc;
  };

  for (const u of connectedUsers) {
    if (u.role === 'PLAYER') bump(u.id, u.username);
  }
  for (const p of store.listPlayers()) {
    bump(p.userId, p.userName);
  }
  for (const [id, doc] of Object.entries(store.docsById)) {
    bump(id, doc.userName);
  }
  for (const c of useInitiativeStore.getState().combatants) {
    if (!c.tokenId) continue;
    const item = useItemStore.getState().items[c.tokenId];
    if (!item || item.type !== 'token') continue;
    const ownerId = item.ownerId?.trim();
    if (!ownerId || isGmUserId(ownerId)) continue;
    const owner = connectedUsers.find((u) => u.id === ownerId);
    if (owner?.role === 'GM') continue;
    bump(ownerId, owner?.username || item.name || c.name);
  }
  if (myRole !== 'GM' && myUserId) {
    const me = connectedUsers.find((u) => u.id === myUserId);
    bump(myUserId, me?.username || resolveLocalUserName().userName);
  }
  if (seen.size === 0) {
    const active = store.activeUserId;
    if (active && active !== OVERALL_STATS_ID && !isGmUserId(active)) {
      const doc = store.docsById[active];
      bump(active, doc?.userName || 'Player');
    }
  }

  if (Object.keys(mutatedById).length > 0) {
    useStatMakerStore.setState((s) => ({
      docsById: { ...s.docsById, ...mutatedById },
    }));
    for (const doc of Object.values(mutatedById)) {
      pushDocSync(doc);
      emitRoundStatEvent(doc.userId, doc.userName, initRound);
    }
  } else {
    for (const userId of emitIds) {
      const doc = store.docsById[userId];
      emitRoundStatEvent(userId, doc?.userName || 'Player', initRound);
    }
  }
}

/**
 * Push the current initiative round onto player stats docs.
 * Coalesces rapid next-turn calls into one microtask so the UI stays snappy.
 */
export function syncInitiativeRoundToAllPlayerStats(round?: number): void {
  const initRound = round ?? liveInitiativeCombatRounds();
  if (initRound < 1) return;
  pendingRoundSync = initRound;
  if (roundSyncScheduled) return;
  roundSyncScheduled = true;
  queueMicrotask(() => {
    roundSyncScheduled = false;
    const r = pendingRoundSync;
    pendingRoundSync = null;
    if (r != null && r >= 1) flushInitiativeRoundSync(r);
  });
}

function mutatePlayerDoc(
  ref: StatUserRef,
  fn: (doc: PlayerStatDoc) => void,
  syncDoc = false,
): boolean {
  const target = playerStatTarget(ref);
  if (!target) return false;
  const store = useStatMakerStore.getState();
  const base = store.ensurePlayerDoc(target);
  const doc = cloneDoc(base);
  touchSession(doc);
  const before = JSON.stringify(doc);
  fn(doc);
  if (JSON.stringify(doc) === before) return false;
  writeDoc(doc);
  useStatMakerStore.setState((s) => ({
    docsById: { ...s.docsById, [doc.userId]: doc },
  }));
  if (syncDoc) pushDocSync(doc);
  return true;
}

const appliedEventIds = new Set<string>();
const APPLIED_MAX = 120;

function markApplied(eventId: string): boolean {
  if (appliedEventIds.has(eventId)) return false;
  appliedEventIds.add(eventId);
  if (appliedEventIds.size > APPLIED_MAX) {
    const first = appliedEventIds.values().next().value;
    if (first) appliedEventIds.delete(first);
  }
  return true;
}

function broadcastStatsEvent(payload: Omit<StatsEventPayload, 'sessionId'>): void {
  const sessionId = useSessionStore.getState().sessionId;
  if (!sessionId) return;
  try {
    getSocket().emit('stats:event', { ...payload, sessionId });
  } catch {
    /* offline */
  }
}

/** Apply a stats event locally (and optionally skip re-broadcast when from peer). */
export function applyStatsEvent(
  payload: StatsEventPayload,
  opts?: { fromRemote?: boolean },
): void {
  const ref = playerStatTarget({ userId: payload.userId, userName: payload.userName });
  if (!ref) return;

  // Rounds are set-max and may no-op locally while peers still need the event —
  // only dedupe after a successful change (or always for incrementing kinds).
  const dedupeFirst = payload.kind !== 'round';
  if (dedupeFirst && !markApplied(payload.eventId)) return;

  let changed = false;
  if (payload.kind === 'object') {
    changed = mutatePlayerDoc(ref, (doc) => {
      if (doc.objectsInteracted.some((e) => e.id === payload.eventId)) return;
      const at = payload.at;
      const recent = doc.objectsInteracted.find(
        (e) =>
          e.name === (payload.propName || 'Object')
          && (e.action === payload.action || e.action.startsWith('dm-approved'))
          && Math.abs(at - e.at) < 2500,
      );
      // Prefer a single credit: drop a near-duplicate interact when dm-approved arrives.
      if (payload.action?.startsWith('dm-approved') && recent && recent.action === 'interact') {
        doc.objectsInteracted = doc.objectsInteracted.filter((e) => e.id !== recent.id);
      } else if (recent) {
        return;
      }
      const sessionId = useSessionStore.getState().sessionId;
      doc.objectsInteracted.unshift({
        id: payload.eventId,
        name: payload.propName || 'Object',
        action: payload.action || 'interact',
        at,
        ...(sessionId ? { sessionId } : {}),
      });
      doc.objectsInteracted = doc.objectsInteracted.slice(0, 200);
    });
  } else if (payload.kind === 'creature') {
    changed = mutatePlayerDoc(ref, (doc) => {
      if (doc.creaturesDefeated.some((e) => e.id === payload.eventId)) return;
      const sessionId = useSessionStore.getState().sessionId;
      doc.creaturesDefeated.unshift({
        id: payload.eventId,
        name: payload.creatureName || 'Creature',
        at: payload.at,
        ...(payload.round != null ? { round: payload.round } : {}),
        ...(sessionId ? { sessionId } : {}),
      });
      doc.creaturesDefeated = doc.creaturesDefeated.slice(0, 200);
    });
  } else if (payload.kind === 'downed') {
    changed = mutatePlayerDoc(ref, (doc) => {
      doc.timesDowned += 1;
    });
  } else if (payload.kind === 'round') {
    const targetRound = payload.round ?? 0;
    if (targetRound >= 1) {
      changed = mutatePlayerDoc(ref, (doc) => {
        if (doc.combatRounds === targetRound) return;
        doc.combatRounds = targetRound;
      });
      markApplied(payload.eventId);
    }
  }

  // Round updates are broadcast by ensureCombatRoundsAtLeast directly.
  if (changed && !opts?.fromRemote && payload.kind !== 'round') {
    // Event only — do not also pushDocSync here (doc+event was double-counting downs).
    broadcastStatsEvent({
      eventId: payload.eventId,
      kind: payload.kind,
      userId: ref.userId,
      userName: ref.userName,
      at: payload.at,
      ...(payload.propItemId != null ? { propItemId: payload.propItemId } : {}),
      ...(payload.propName != null ? { propName: payload.propName } : {}),
      ...(payload.action != null ? { action: payload.action } : {}),
      ...(payload.combatantId != null ? { combatantId: payload.combatantId } : {}),
      ...(payload.creatureName != null ? { creatureName: payload.creatureName } : {}),
      ...(payload.round != null ? { round: payload.round } : {}),
    });
  }
}

/** Record against a specific player (defaults to local player — never GM). */
export function recordObjectInteract(opts: {
  propItemId: string;
  propName: string;
  action: string;
  at?: number;
  forUser?: StatUserRef;
  eventId?: string;
}): void {
  const ref = playerStatTarget(opts.forUser) ?? playerStatTarget(resolveLocalUserName());
  if (!ref) return;
  const at = opts.at ?? Date.now();
  const eventId = opts.eventId ?? `obj:${opts.propItemId}:${opts.action}:${Math.floor(at / 2000)}:${ref.userId}`;
  applyStatsEvent({
    sessionId: useSessionStore.getState().sessionId ?? '',
    eventId,
    kind: 'object',
    userId: ref.userId,
    userName: ref.userName,
    at,
    propItemId: opts.propItemId,
    propName: opts.propName,
    action: opts.action,
  });
}

export const recordApprovedObjectInteract = recordObjectInteract;

export function recordCreatureDefeated(opts: {
  combatantId: string;
  name: string;
  round?: number;
  forUser?: StatUserRef;
}): void {
  const ref = playerStatTarget(opts.forUser) ?? playerStatTarget(resolveLocalUserName());
  if (!ref) return;
  const at = Date.now();
  // Include userId so each party member can get their own credit; stable across clients.
  const eventId = `kill:${opts.combatantId}:${opts.round ?? 0}:${ref.userId}`;
  applyStatsEvent({
    sessionId: useSessionStore.getState().sessionId ?? '',
    eventId,
    kind: 'creature',
    userId: ref.userId,
    userName: ref.userName,
    at,
    combatantId: opts.combatantId,
    creatureName: opts.name,
    ...(opts.round != null ? { round: opts.round } : {}),
  });
}

export function recordLocalDowned(forUser?: StatUserRef, eventId?: string): void {
  const ref = playerStatTarget(forUser) ?? playerStatTarget(resolveLocalUserName());
  if (!ref) return;
  const at = Date.now();
  applyStatsEvent({
    sessionId: useSessionStore.getState().sessionId ?? '',
    eventId: eventId ?? `down:${ref.userId}:${Math.floor(at / 1000)}`,
    kind: 'downed',
    userId: ref.userId,
    userName: ref.userName,
    at,
  });
}

export function recordCombatRound(forUser?: StatUserRef, eventId?: string): void {
  const ref = playerStatTarget(forUser) ?? playerStatTarget(resolveLocalUserName());
  if (!ref) return;
  const at = Date.now();
  applyStatsEvent({
    sessionId: useSessionStore.getState().sessionId ?? '',
    eventId: eventId ?? `round:${ref.userId}:${Math.floor(at / 500)}`,
    kind: 'round',
    userId: ref.userId,
    userName: ref.userName,
    at,
  });
}

function isGmOwnedDoc(doc: PlayerStatDoc): boolean {
  const u = useSessionStore.getState().connectedUsers.find((x) => x.id === doc.userId);
  if (u?.role === 'GM') return true;
  const { myUserId, myRole } = useSessionStore.getState();
  return Boolean(myRole === 'GM' && myUserId && doc.userId === myUserId);
}

/**
 * Party-wide rollup of individual player docs. Creatures are de-duped when several
 * PCs were credited for the same kill; combat rounds use the max (shared fight).
 */
export function buildOverallStatDoc(
  docsById: Record<string, PlayerStatDoc>,
  playerRefs?: StatUserRef[],
): OverallStatDoc {
  const refs = playerRefs ?? useStatMakerStore.getState().listPlayers();
  const docs = refs
    .map((r) => docsById[r.userId])
    .filter((d): d is PlayerStatDoc => Boolean(d) && !isGmOwnedDoc(d));

  const objects: StatObjectEntryView[] = [];
  for (const doc of docs) {
    for (const o of doc.objectsInteracted) {
      objects.push({
        ...o,
        id: `${doc.userId}:${o.id}`,
        playerName: doc.userName,
      });
    }
  }
  objects.sort((a, b) => b.at - a.at);

  // De-dupe party kills: same combatantId (id prefix) within a few seconds.
  const creatures: StatCreatureEntryView[] = [];
  const seenKill = new Map<string, number>();
  const rawKills: StatCreatureEntryView[] = [];
  for (const doc of docs) {
    for (const c of doc.creaturesDefeated) {
      rawKills.push({ ...c, playerName: doc.userName });
    }
  }
  rawKills.sort((a, b) => b.at - a.at);
  for (const c of rawKills) {
    const combatantKey = c.id.includes(':') ? c.id.slice(0, c.id.indexOf(':')) : c.id;
    const dedupeKey = `${combatantKey}:${c.name}:${c.round ?? ''}`;
    const prevAt = seenKill.get(dedupeKey);
    if (prevAt != null && Math.abs(prevAt - c.at) < 5000) continue;
    seenKill.set(dedupeKey, c.at);
    creatures.push(c);
  }

  const sessions = new Set<string>();
  let timesDowned = 0;
  let combatRounds = 0;
  let updatedAt = 0;
  let createdAt = Date.now();
  for (const doc of docs) {
    timesDowned += doc.timesDowned;
    combatRounds = Math.max(combatRounds, doc.combatRounds);
    updatedAt = Math.max(updatedAt, doc.updatedAt);
    createdAt = Math.min(createdAt, doc.createdAt);
    for (const s of doc.sessionsTouched) sessions.add(s);
  }
  // Active combat wins — do not keep a stale high-water from a previous fight.
  const liveRounds = liveInitiativeCombatRounds();
  if (liveRounds >= 1) combatRounds = liveRounds;

  return {
    userName: 'Overall',
    userId: OVERALL_STATS_ID,
    createdAt,
    updatedAt: updatedAt || Date.now(),
    objectsInteracted: objects.slice(0, 400),
    creaturesDefeated: creatures.slice(0, 400),
    timesDowned,
    combatRounds,
    sessionsTouched: [...sessions].slice(-40),
    playerCount: docs.length,
    playerNames: docs.map((d) => d.userName),
  };
}

export function formatStatDocumentMarkdown(doc: PlayerStatDoc | OverallStatDoc): string {
  const fmt = (t: number) => new Date(t).toLocaleString();
  const uniqueObjects = [...new Set(doc.objectsInteracted.map((o) => o.name))];
  const uniqueCreatures = [...new Set(doc.creaturesDefeated.map((c) => c.name))];
  const isOverall = doc.userId === OVERALL_STATS_ID;
  const overall = isOverall ? (doc as OverallStatDoc) : null;
  const lines = [
    `# ${doc.userName} — Adventure Stats`,
    '',
    `Updated: ${fmt(doc.updatedAt)}`,
    isOverall
      ? `Players: ${overall!.playerNames.join(', ') || '—'} (${overall!.playerCount})`
      : `Player id: ${doc.userId}`,
    '',
    '## Summary',
    `- Objects interacted (approved / rolled / free): **${doc.objectsInteracted.length}** (${uniqueObjects.length} unique)`,
    `- Creatures defeated (initiative): **${doc.creaturesDefeated.length}** (${uniqueCreatures.length} unique)`,
    `- Times downed: **${doc.timesDowned}**`,
    `- Combat rounds: **${effectiveCombatRounds(doc)}**${isOverall ? ' (party max)' : ''}`,
    `- Sessions logged: **${doc.sessionsTouched.length}**`,
    '',
    '## Objects interacted',
    '_Includes DM-approved uses, successful activate/reveal rolls, and free interacts._',
  ];
  if (!doc.objectsInteracted.length) {
    lines.push('_None yet._', '');
  } else {
    for (const o of doc.objectsInteracted) {
      const by = 'playerName' in o && o.playerName ? ` · ${o.playerName}` : '';
      lines.push(`- ${fmt(o.at)} — **${o.name}** (${o.action}${by})`);
    }
    lines.push('');
  }
  lines.push('## Creatures defeated');
  if (!doc.creaturesDefeated.length) {
    lines.push('_None yet._', '');
  } else {
    for (const c of doc.creaturesDefeated) {
      const round = c.round != null ? ` · round ${c.round}` : '';
      const by = 'playerName' in c && c.playerName ? ` · ${c.playerName}` : '';
      lines.push(`- ${fmt(c.at)} — **${c.name}**${round}${by}`);
    }
    lines.push('');
  }
  lines.push('---', '_Local document only — not stored on the VTT server._', '');
  return lines.join('\n');
}

export function downloadStatDocument(doc: PlayerStatDoc | OverallStatDoc): void {
  const body = formatStatDocumentMarkdown(doc);
  const blob = new Blob([body], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeFileStem(doc.userName)}-stats.md`;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadStatDocumentJson(doc: PlayerStatDoc | OverallStatDoc): void {
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeFileStem(doc.userName)}-stats.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Resolve a session user id + display name for stats attribution. */
export function resolveStatUserRef(userId: string, fallbackName?: string): StatUserRef {
  const u = useSessionStore.getState().connectedUsers.find((x) => x.id === userId);
  const stored = useStatMakerStore.getState().docsById[userId];
  const userName = (
    (!isGenericPlayerLabel(u?.username) ? u!.username : null)
    || (!isGenericPlayerLabel(fallbackName) ? fallbackName : null)
    || (!isGenericPlayerLabel(stored?.userName) ? stored!.userName : null)
    || u?.username
    || fallbackName
    || 'Player'
  ).trim();
  return { userId, userName };
}
