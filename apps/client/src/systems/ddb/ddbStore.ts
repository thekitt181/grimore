import { create } from 'zustand';
import type { TokenItem } from '@/systems/scene/types';

interface DdbUiState {
  linkPanelOpen: boolean;
  importModalOpen: boolean;
  importLinkTokenId: string | null;
  sheetToken: TokenItem | null;
  pcActionsToken: TokenItem | null;
  encounterPanelOpen: boolean;
  libraryPanelOpen: boolean;
  /** Bumped to re-trigger roll bridge after campaign link / settings change. */
  rollBridgeNonce: number;
  setLinkPanelOpen: (v: boolean) => void;
  setImportModalOpen: (v: boolean, linkTokenId?: string | null) => void;
  openSheet: (token: TokenItem) => void;
  closeSheet: () => void;
  openPcActions: (token: TokenItem) => void;
  closePcActions: () => void;
  setEncounterPanelOpen: (v: boolean) => void;
  setLibraryPanelOpen: (v: boolean) => void;
  bumpRollBridge: () => void;
}

export const useDdbStore = create<DdbUiState>((set) => ({
  linkPanelOpen: false,
  importModalOpen: false,
  importLinkTokenId: null,
  sheetToken: null,
  pcActionsToken: null,
  encounterPanelOpen: false,
  libraryPanelOpen: false,
  rollBridgeNonce: 0,
  setLinkPanelOpen: (linkPanelOpen) => set({ linkPanelOpen }),
  setImportModalOpen: (importModalOpen, importLinkTokenId = null) =>
    set({ importModalOpen, importLinkTokenId: importModalOpen ? importLinkTokenId : null }),
  openSheet: (sheetToken) => set({ sheetToken }),
  closeSheet: () => set({ sheetToken: null }),
  openPcActions: (pcActionsToken) => set({ pcActionsToken }),
  closePcActions: () => set({ pcActionsToken: null }),
  setEncounterPanelOpen: (encounterPanelOpen) => set({ encounterPanelOpen }),
  setLibraryPanelOpen: (libraryPanelOpen) => set({ libraryPanelOpen }),
  bumpRollBridge: () => set((s) => ({ rollBridgeNonce: s.rollBridgeNonce + 1 })),
}));
