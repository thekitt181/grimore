import { create } from 'zustand';

const ARM_TTL_MS = 120_000;

export type PropCheckKind = 'reveal' | 'activate';

export interface PropDdbArm {
  propId: string;
  propName: string;
  checkId: string;
  dc: number;
  kind: PropCheckKind;
  /** Prefer matching this DDB character when present. */
  ddbCharacterId?: number;
  characterName?: string;
  armedAt: number;
}

interface PropDdbArmState {
  pending: PropDdbArm | null;
  arm: (next: PropDdbArm) => void;
  clear: () => void;
  /** Drop expired arms; returns current pending or null. */
  getFreshPending: () => PropDdbArm | null;
}

export const usePropDdbArmStore = create<PropDdbArmState>((set, get) => ({
  pending: null,

  arm: (next) => set({ pending: next }),

  clear: () => set({ pending: null }),

  getFreshPending: () => {
    const pending = get().pending;
    if (!pending) return null;
    if (Date.now() - pending.armedAt > ARM_TTL_MS) {
      set({ pending: null });
      return null;
    }
    return pending;
  },
}));

export { ARM_TTL_MS };
