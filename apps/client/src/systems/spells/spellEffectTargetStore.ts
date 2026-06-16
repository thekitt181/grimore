import { create } from 'zustand';

export interface SpellTargetPick {
  casterTokenId: string;
  casterName: string;
  spellName: string;
  maxTargets: number;
  castLevel?: number;
  projectileCount?: number;
  /** When true, each click adds one projectile to that target (duplicates allowed). */
  allowRepeatTargets?: boolean;
  selectedTargetIds: string[];
  hoverTokenId: string | null;
}

interface SpellEffectTargetState {
  pick: SpellTargetPick | null;
  beginPick: (pick: Omit<SpellTargetPick, 'selectedTargetIds' | 'hoverTokenId'>) => void;
  addTargetAllocation: (tokenId: string) => void;
  removeTargetAllocation: (tokenId: string) => void;
  toggleTarget: (tokenId: string) => void;
  setTargets: (tokenIds: string[]) => void;
  setHoverToken: (tokenId: string | null) => void;
  clearPick: () => void;
}

function maxAllocations(pick: SpellTargetPick): number {
  return pick.projectileCount ?? pick.maxTargets;
}

export const useSpellEffectTargetStore = create<SpellEffectTargetState>((set, get) => ({
  pick: null,

  beginPick: (pick) => set({ pick: { ...pick, selectedTargetIds: [], hoverTokenId: null } }),

  addTargetAllocation: (tokenId) => {
    const pick = get().pick;
    if (!pick || tokenId === pick.casterTokenId) return;

    if (pick.allowRepeatTargets) {
      if (pick.selectedTargetIds.length >= maxAllocations(pick)) return;
      set({
        pick: {
          ...pick,
          selectedTargetIds: [...pick.selectedTargetIds, tokenId],
          hoverTokenId: null,
        },
      });
      return;
    }

    if (pick.maxTargets === 1) {
      set({ pick: { ...pick, selectedTargetIds: [tokenId], hoverTokenId: null } });
      return;
    }

    if (pick.selectedTargetIds.includes(tokenId)) return;
    if (pick.selectedTargetIds.length >= pick.maxTargets) return;
    set({
      pick: {
        ...pick,
        selectedTargetIds: [...pick.selectedTargetIds, tokenId],
        hoverTokenId: null,
      },
    });
  },

  removeTargetAllocation: (tokenId) => {
    const pick = get().pick;
    if (!pick || tokenId === pick.casterTokenId) return;

    if (pick.allowRepeatTargets) {
      const idx = pick.selectedTargetIds.lastIndexOf(tokenId);
      if (idx < 0) return;
      const next = [...pick.selectedTargetIds];
      next.splice(idx, 1);
      set({ pick: { ...pick, selectedTargetIds: next, hoverTokenId: null } });
      return;
    }

    if (!pick.selectedTargetIds.includes(tokenId)) return;
    set({
      pick: {
        ...pick,
        selectedTargetIds: pick.selectedTargetIds.filter((id) => id !== tokenId),
        hoverTokenId: null,
      },
    });
  },

  toggleTarget: (tokenId) => {
    const pick = get().pick;
    if (!pick || tokenId === pick.casterTokenId) return;

    if (pick.allowRepeatTargets) {
      get().addTargetAllocation(tokenId);
      return;
    }

    if (pick.maxTargets === 1) {
      set({ pick: { ...pick, selectedTargetIds: [tokenId], hoverTokenId: null } });
      return;
    }

    const has = pick.selectedTargetIds.includes(tokenId);
    const next = has
      ? pick.selectedTargetIds.filter((id) => id !== tokenId)
      : [...pick.selectedTargetIds, tokenId];
    if (!has && next.length > pick.maxTargets) return;
    set({ pick: { ...pick, selectedTargetIds: next, hoverTokenId: null } });
  },

  setTargets: (tokenIds) => {
    const pick = get().pick;
    if (!pick) return;
    const limit = pick.allowRepeatTargets ? maxAllocations(pick) : pick.maxTargets;
    set({ pick: { ...pick, selectedTargetIds: tokenIds.slice(0, limit), hoverTokenId: null } });
  },

  setHoverToken: (tokenId) => {
    const pick = get().pick;
    if (!pick) return;
    if (tokenId === pick.hoverTokenId) return;
    set({ pick: { ...pick, hoverTokenId: tokenId } });
  },

  clearPick: () => set({ pick: null }),
}));

export function countTargetAllocations(targetIds: string[], tokenId: string): number {
  return targetIds.filter((id) => id === tokenId).length;
}

export function summarizeTargetAllocations(
  targetIds: string[],
  nameById: (id: string) => string | null,
): string {
  const counts = new Map<string, number>();
  for (const id of targetIds) {
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([id, n]) => {
      const name = nameById(id) ?? 'Target';
      return n > 1 ? `${name} ×${n}` : name;
    })
    .join(', ');
}
