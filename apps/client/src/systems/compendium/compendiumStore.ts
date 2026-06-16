import { create } from 'zustand';
import type { CompendiumItem, CompendiumMonster, CompendiumSpell } from '@grimoire/shared';

export type CompendiumTab = 'monsters' | 'items' | 'spells';
export type CompendiumBrowseMode = 'all' | 'sources' | 'homebrew' | 'effects';

interface CompendiumUiState {
  tab: CompendiumTab;
  browseMode: CompendiumBrowseMode;
  selectedSource: string | null;
  query: string;
  selectedMonsterId: string | null;
  selectedItemId: string | null;
  selectedSpellId: string | null;
  /** Catalog id when browsing Spells → Effects (e.g. fireball). */
  selectedEffectSpellId: string | null;
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
  selectEffectSpell: (id: string | null) => void;
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
  selectedEffectSpellId: null,
  panelOpen: false,
  creating: false,
  lastSyncAt: null,
  summonAt: null,
  setTab: (tab) => set((s) => ({
    tab,
    selectedSource: null,
    ...(tab !== 'spells' && s.browseMode === 'effects' ? { browseMode: 'all' as const, selectedEffectSpellId: null } : {}),
  })),
  setBrowseMode: (browseMode) => set({
    browseMode,
    selectedSource: null,
    ...(browseMode === 'effects' ? { selectedSpellId: null } : { selectedEffectSpellId: null }),
  }),
  setSelectedSource: (selectedSource) => set({ selectedSource }),
  setQuery: (query) => set({ query }),
  selectMonster: (selectedMonsterId) => set({
    selectedMonsterId,
    selectedItemId: null,
    selectedSpellId: null,
    selectedEffectSpellId: null,
    creating: false,
    panelOpen: selectedMonsterId !== null,
  }),
  selectItem: (selectedItemId) => set({
    selectedItemId,
    selectedMonsterId: null,
    selectedSpellId: null,
    selectedEffectSpellId: null,
    creating: false,
    panelOpen: selectedItemId !== null,
  }),
  selectSpell: (selectedSpellId) => set({
    selectedSpellId,
    selectedMonsterId: null,
    selectedItemId: null,
    selectedEffectSpellId: null,
    creating: false,
    panelOpen: selectedSpellId !== null,
  }),
  selectEffectSpell: (selectedEffectSpellId) => set({
    selectedEffectSpellId,
    selectedMonsterId: null,
    selectedItemId: null,
    creating: false,
    panelOpen: selectedEffectSpellId !== null,
  }),
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
    selectedEffectSpellId: null,
  }),
}));

export type { CompendiumMonster, CompendiumItem, CompendiumSpell };
