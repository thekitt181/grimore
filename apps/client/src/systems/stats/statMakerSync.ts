/**
 * Relay adventure-stat events + full docs so DM + player stay aligned.
 */
import type { Socket } from 'socket.io-client';
import type {
  StatsDocSyncPayload,
  StatsEventPayload,
  StatsSyncRequestPayload,
} from '@grimoire/shared';
import { getSocket } from '@/lib/socket';
import { useSessionStore } from '@/store/sessionStore';
import {
  applyStatsEvent,
  clearAllPlayerStats,
  mergePeerStatDoc,
  pushAllStatDocs,
} from './statMaker';

let bound: Socket | null = null;

function onStatsEvent(payload: StatsEventPayload): void {
  const sessionId = useSessionStore.getState().sessionId;
  if (!sessionId || payload.sessionId !== sessionId) return;
  applyStatsEvent(payload, { fromRemote: true });
}

function onStatsDoc(payload: StatsDocSyncPayload): void {
  const sessionId = useSessionStore.getState().sessionId;
  if (!sessionId || payload.sessionId !== sessionId) return;
  mergePeerStatDoc(
    {
      userName: payload.doc.userName || payload.userName,
      userId: payload.doc.userId || payload.userId,
      createdAt: payload.doc.createdAt,
      updatedAt: payload.doc.updatedAt,
      objectsInteracted: payload.doc.objectsInteracted ?? [],
      creaturesDefeated: payload.doc.creaturesDefeated ?? [],
      timesDowned: payload.doc.timesDowned ?? 0,
      combatRounds: payload.doc.combatRounds ?? 0,
      sessionsTouched: payload.doc.sessionsTouched ?? [],
    },
    Boolean(payload.replace),
  );
}

function onStatsSyncRequest(payload: StatsSyncRequestPayload): void {
  const sessionId = useSessionStore.getState().sessionId;
  if (!sessionId || payload.sessionId !== sessionId) return;
  if (payload.mode === 'clear-all') {
    clearAllPlayerStats(false);
    return;
  }
  pushAllStatDocs();
}

export function bindStatMakerSync(socket: Socket = getSocket()): void {
  if (bound === socket) return;
  if (bound) unbindStatMakerSync(bound);
  bound = socket;
  socket.on('stats:event', onStatsEvent as never);
  socket.on('stats:doc', onStatsDoc as never);
  socket.on('stats:syncRequest', onStatsSyncRequest as never);
}

export function unbindStatMakerSync(socket: Socket = getSocket()): void {
  socket.off('stats:event', onStatsEvent as never);
  socket.off('stats:doc', onStatsDoc as never);
  socket.off('stats:syncRequest', onStatsSyncRequest as never);
  if (bound === socket) bound = null;
}
