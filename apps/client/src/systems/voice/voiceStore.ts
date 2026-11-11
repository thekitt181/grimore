import { create } from 'zustand';

export interface VoicePeerUi {
  socketId: string;
  userId: string;
  username: string;
  muted: boolean;
  speaking: boolean;
  failed: boolean;
}

interface VoiceState {
  joined: boolean;
  joining: boolean;
  muted: boolean;
  deafened: boolean;
  error: string | null;
  selfSpeaking: boolean;
  selfSocketId: string | null;
  speakingByUserId: Record<string, boolean>;
  peers: Record<string, VoicePeerUi>;
  setJoining: (joining: boolean) => void;
  setJoined: (joined: boolean) => void;
  setMuted: (muted: boolean) => void;
  setDeafened: (deafened: boolean) => void;
  setError: (error: string | null) => void;
  setSelfSpeaking: (selfSpeaking: boolean) => void;
  setSelfSocketId: (selfSocketId: string | null) => void;
  setUserSpeaking: (userId: string, speaking: boolean) => void;
  upsertPeer: (peer: VoicePeerUi) => void;
  patchPeer: (socketId: string, patch: Partial<VoicePeerUi>) => void;
  removePeer: (socketId: string) => void;
  reset: () => void;
}

const empty = {
  joined: false,
  joining: false,
  muted: false,
  deafened: false,
  error: null as string | null,
  selfSpeaking: false,
  selfSocketId: null as string | null,
  speakingByUserId: {} as Record<string, boolean>,
  peers: {} as Record<string, VoicePeerUi>,
};

export const useVoiceStore = create<VoiceState>((set) => ({
  ...empty,
  setJoining: (joining) => set({ joining }),
  setJoined: (joined) => set({ joined, joining: false }),
  setMuted: (muted) => set({ muted }),
  setDeafened: (deafened) => set({ deafened }),
  setError: (error) => set({ error }),
  setSelfSpeaking: (selfSpeaking) => set({ selfSpeaking }),
  setSelfSocketId: (selfSocketId) => set({ selfSocketId }),
  setUserSpeaking: (userId, speaking) =>
    set((s) => {
      if (!userId) return s;
      if (!speaking) {
        if (!s.speakingByUserId[userId]) return s;
        const { [userId]: _drop, ...rest } = s.speakingByUserId;
        return { speakingByUserId: rest };
      }
      if (s.speakingByUserId[userId]) return s;
      return { speakingByUserId: { ...s.speakingByUserId, [userId]: true } };
    }),
  upsertPeer: (peer) => set((s) => ({ peers: { ...s.peers, [peer.socketId]: peer } })),
  patchPeer: (socketId, patch) =>
    set((s) => {
      const prev = s.peers[socketId];
      if (!prev) return s;
      return { peers: { ...s.peers, [socketId]: { ...prev, ...patch } } };
    }),
  removePeer: (socketId) =>
    set((s) => {
      const { [socketId]: _drop, ...rest } = s.peers;
      return { peers: rest };
    }),
  reset: () =>
    set((s) => ({
      ...empty,
      peers: {},
      speakingByUserId: s.speakingByUserId,
    })),
}));
