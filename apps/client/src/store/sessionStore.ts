import { create } from 'zustand';
import type { SessionUser } from '@grimoire/shared';

interface SessionState {
  sessionId: string | null;
  campaignId: string | null;
  myUserId: string | null;
  connectedUsers: SessionUser[];
  myRole: 'GM' | 'PLAYER' | null;
  isConnected: boolean;
  connectionError: string | null;
  setSession: (sessionId: string, campaignId: string) => void;
  setMyRole: (role: 'GM' | 'PLAYER') => void;
  setMyUserId: (id: string) => void;
  setConnected: (connected: boolean) => void;
  setConnectionError: (message: string | null) => void;
  clearConnectionError: () => void;
  setConnectedUsers: (users: SessionUser[]) => void;
  addUser: (user: SessionUser) => void;
  removeUser: (userId: string) => void;
  clearSession: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  sessionId: null,
  campaignId: null,
  myUserId: null,
  connectedUsers: [],
  myRole: null,
  isConnected: false,
  connectionError: null,

  setSession: (sessionId, campaignId) => set({ sessionId, campaignId }),
  setMyRole: (myRole) => set({ myRole }),
  setMyUserId: (myUserId) => set({ myUserId }),
  setConnected: (isConnected) => set({ isConnected }),
  setConnectionError: (connectionError) => set({ connectionError }),
  clearConnectionError: () => set({ connectionError: null }),
  setConnectedUsers: (connectedUsers) => set({ connectedUsers }),

  addUser: (user) =>
    set((state) => ({
      connectedUsers: state.connectedUsers.some((u) => u.id === user.id)
        ? state.connectedUsers
        : [...state.connectedUsers, user],
    })),

  removeUser: (userId) =>
    set((state) => ({
      connectedUsers: state.connectedUsers.filter((u) => u.id !== userId),
    })),

  clearSession: () =>
    set({
      sessionId: null,
      campaignId: null,
      myUserId: null,
      connectedUsers: [],
      myRole: null,
      isConnected: false,
      connectionError: null,
    }),
}));
