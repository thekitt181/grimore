import { create } from 'zustand';
import type { MapPingPayload } from '@grimoire/shared';

export const PING_LIFE_MS = 2400;
const MAX_PINGS = 8;

export interface TablePing {
  pingId: string;
  x: number;
  y: number;
  userId: string;
  userName: string;
  lookHere: boolean;
  startedAt: number;
}

interface MapPingState {
  pings: TablePing[];
  /** When the ping tool is active, Shift is optional — this toggle always adds the callout. */
  lookHereDefault: boolean;
  setLookHereDefault: (v: boolean) => void;
  addPing: (payload: Omit<TablePing, 'startedAt'> & { startedAt?: number }) => void;
  prune: () => void;
}

export const useMapPingStore = create<MapPingState>((set, get) => ({
  pings: [],
  lookHereDefault: false,
  setLookHereDefault: (lookHereDefault) => set({ lookHereDefault }),
  addPing: (payload) => {
    const ping: TablePing = {
      pingId: payload.pingId,
      x: payload.x,
      y: payload.y,
      userId: payload.userId,
      userName: payload.userName,
      lookHere: payload.lookHere,
      startedAt: payload.startedAt ?? Date.now(),
    };
    set((s) => ({
      pings: [...s.pings.filter((p) => p.pingId !== ping.pingId), ping].slice(-MAX_PINGS),
    }));
  },
  prune: () => {
    const cutoff = Date.now() - PING_LIFE_MS;
    const next = get().pings.filter((p) => p.startedAt > cutoff);
    if (next.length !== get().pings.length) set({ pings: next });
  },
}));

export function ingestMapPing(payload: MapPingPayload): void {
  if (!Number.isFinite(payload.x) || !Number.isFinite(payload.y)) return;
  useMapPingStore.getState().addPing({
    pingId: payload.pingId,
    x: payload.x,
    y: payload.y,
    userId: payload.userId,
    userName: payload.userName,
    lookHere: payload.lookHere,
  });
}
