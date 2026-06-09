import { create } from 'zustand';
import type { CompendiumItem, CompendiumMonster, CompendiumSpell } from '@grimoire/shared';

export type CompendiumTab = 'monsters' | 'items' | 'spells';
export type CompendiumBrowseMode = 'all' | 'sources' | 'homebrew';

interface CompendiumUiState {
  tab: CompendiumTab;
  browseMode: CompendiumBrowseMode;
  selectedSource: string | null;
  query: string;
  selectedMonsterId: string | null;
  selectedItemId: string | null;
  selectedSpellId: string | null;
  panelOpen: boolean;
  creating: boolean;
  lastSyncAt: string | null;
  summonAt: { x: number; y: number } | null;
  setTab: (tab: CompendiumTab) => void;
  setBrowseMode: (mode: CompendiumBrowseMode) => void;
  setSelectedSource: (source: string | null) => void;
  setQuery: (q: string) => void;
  selectMonster: (id: string | null) => void;
  selectItem: (id: string | null) => void;
  selectSpell: (id: string | null) => void;
  setPanelOpen: (open: boolean) => void;
  setCreating: (creating: boolean) => void;
  setLastSyncAt: (ts: string | null) => void;
  setSummonAt: (at: { x: number; y: number } | null) => void;
  startCreate: () => void;
}

export const useCompendiumUiStore = create<CompendiumUiState>((set) => ({
  tab: 'monsters',
  browseMode: 'all',
  selectedSource: null,
  query: '',
  selectedMonsterId: null,
  selectedItemId: null,
  selectedSpellId: null,
  panelOpen: false,
  creating: false,
  lastSyncAt: null,
  summonAt: null,
  setTab: (tab) => set({ tab, selectedSource: null }),
  setBrowseMode: (browseMode) => set({ browseMode, selectedSource: null }),
  setSelectedSource: (selectedSource) => set({ selectedSource }),
  setQuery: (query) => set({ query }),
  selectMonster: (selectedMonsterId) => set({ selectedMonsterId, selectedItemId: null, selectedSpellId: null, creating: false, panelOpen: selectedMonsterId !== null }),
  selectItem: (selectedItemId) => set({ selectedItemId, selectedMonsterId: null, selectedSpellId: null, creating: false, panelOpen: selectedItemId !== null }),
  selectSpell: (selectedSpellId) => set({ selectedSpellId, selectedMonsterId: null, selectedItemId: null, creating: false, panelOpen: selectedSpellId !== null }),
  setPanelOpen: (panelOpen) => set({ panelOpen }),
  setCreating: (creating) => set({ creating, ...(creating ? { selectedMonsterId: null, selectedItemId: null, selectedSpellId: null } : {}) }),
  setLastSyncAt: (lastSyncAt) => set({ lastSyncAt }),
  setSummonAt: (summonAt) => set({ summonAt }),
  startCreate: () => set({
    creating: true,
    panelOpen: true,
    selectedMonsterId: null,
    selectedItemId: null,
    selectedSpellId: null,
  }),
}));

export type { CompendiumMonster, CompendiumItem, CompendiumSpell };
