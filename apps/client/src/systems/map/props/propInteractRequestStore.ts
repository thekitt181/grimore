import { create } from 'zustand';
import type { PropInteractResolveAction } from '@grimoire/shared';

export type PropInteractRequest = {
  requestId: string;
  propItemId: string;
  actorTokenId: string;
  requesterUserId: string;
  requesterName: string;
  propName: string;
  at: number;
};

/** Full request — player waits until DM resolves (same shape as GM inbox). */
type PlayerWait = PropInteractRequest;

interface PropInteractRequestState {
  /** GM inbox — one at a time (newest replaces). */
  gmPending: PropInteractRequest | null;
  /** Player waiting on DM. */
  playerWaiting: PlayerWait | null;
  pushGmRequest: (req: PropInteractRequest) => void;
  clearGmRequest: (requestId?: string) => void;
  setPlayerWaiting: (wait: PlayerWait | null) => void;
  clearPlayerWaiting: (requestId?: string) => void;
}

export const usePropInteractRequestStore = create<PropInteractRequestState>((set, get) => ({
  gmPending: null,
  playerWaiting: null,

  pushGmRequest: (req) => set({ gmPending: req }),

  clearGmRequest: (requestId) => {
    const cur = get().gmPending;
    if (!cur) return;
    if (requestId && cur.requestId !== requestId) return;
    set({ gmPending: null });
  },

  setPlayerWaiting: (playerWaiting) => set({ playerWaiting }),

  clearPlayerWaiting: (requestId) => {
    const cur = get().playerWaiting;
    if (!cur) return;
    if (requestId && cur.requestId !== requestId) return;
    set({ playerWaiting: null });
  },
}));

export type { PropInteractResolveAction };
