import { getSocket } from '@/lib/socket';
import { useMapStore } from '@/systems/map/store/mapStore';
import { useSessionStore } from '@/store/sessionStore';
import type { LootPlayerTakePayload } from '@grimoire/shared';

let lootPolicyHandler: ((payload: LootPlayerTakePayload) => void) | null = null;

export function clampLootCount(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(20, Math.max(1, Math.floor(value)));
}

export function clampLootLevel(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(20, Math.max(1, Math.floor(value)));
}

function currentLootPayload(sessionId: string): LootPlayerTakePayload {
  const map = useMapStore.getState();
  return {
    sessionId,
    playersCanLoot: map.playersCanLoot,
    lootLevel: map.lootLevel,
    lootMin: map.lootMin,
    lootMax: map.lootMax,
  };
}

function applyLootPayload(payload: LootPlayerTakePayload): void {
  const lootMin = payload.lootMin != null ? clampLootCount(payload.lootMin) : undefined;
  const lootMax = payload.lootMax != null ? clampLootCount(payload.lootMax) : undefined;
  useMapStore.getState().setPlayersCanLoot(Boolean(payload.playersCanLoot));
  if (lootMin != null || lootMax != null || payload.lootLevel !== undefined) {
    useMapStore.getState().setLootDefaults({
      ...(payload.lootLevel !== undefined ? { lootLevel: payload.lootLevel } : {}),
      ...(lootMin != null ? { lootMin } : {}),
      ...(lootMax != null ? { lootMax } : {}),
    });
  }
}

export function emitLootPolicy(): void {
  const sessionId = useSessionStore.getState().sessionId;
  if (!sessionId || useSessionStore.getState().myRole !== 'GM') return;
  if (!getSocket().connected) return;
  getSocket().emit('loot:player-take', currentLootPayload(sessionId));
}

export function setPlayersCanLootForSession(enabled: boolean): void {
  useMapStore.getState().setPlayersCanLoot(enabled);
  if (useSessionStore.getState().myRole === 'GM') emitLootPolicy();
}

export function setLootDefaultsForSession(patch: {
  lootLevel?: number | null;
  lootMin?: number;
  lootMax?: number;
}): void {
  const s = useMapStore.getState();
  const nextMin = patch.lootMin != null ? clampLootCount(patch.lootMin) : s.lootMin;
  const nextMax = patch.lootMax != null ? clampLootCount(patch.lootMax) : s.lootMax;
  useMapStore.getState().setLootDefaults({
    ...(patch.lootLevel !== undefined ? { lootLevel: patch.lootLevel } : {}),
    lootMin: Math.min(nextMin, nextMax),
    lootMax: Math.max(nextMin, nextMax),
  });
  if (useSessionStore.getState().myRole === 'GM') emitLootPolicy();
}

export function bindLootPolicySocket(): void {
  const socket = getSocket();
  if (lootPolicyHandler) socket.off('loot:player-take', lootPolicyHandler);
  lootPolicyHandler = (payload) => {
    const sid = useSessionStore.getState().sessionId;
    if (payload.sessionId != null && sid != null && payload.sessionId !== sid) return;
    applyLootPayload(payload);
  };
  socket.on('loot:player-take', lootPolicyHandler);
}

export function syncLootPolicyToSession(): void {
  if (useSessionStore.getState().myRole !== 'GM') return;
  emitLootPolicy();
}
