import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CompendiumSource } from '@grimoire/shared';

interface CompendiumBookSourcesState {
  sources: CompendiumSource[];
  savedAt: string | null;
  setSources: (sources: CompendiumSource[]) => void;
  clearSources: () => void;
}

export const useCompendiumBookSourcesStore = create<CompendiumBookSourcesState>()(
  persist(
    (set) => ({
      sources: [],
      savedAt: null,
      setSources: (sources) => set({ sources, savedAt: new Date().toISOString() }),
      clearSources: () => set({ sources: [], savedAt: null }),
    }),
    { name: 'grimoire-compendium-books' },
  ),
);

export function getPersistedBookSources(): CompendiumSource[] {
  return useCompendiumBookSourcesStore.getState().sources;
}
