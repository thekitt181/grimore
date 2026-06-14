import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface MapSidebarState {
  sidebarCollapsed: boolean;
  gmPanelCollapsed: boolean;
  compendiumCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebarCollapsed: () => void;
  setGmPanelCollapsed: (collapsed: boolean) => void;
  setCompendiumCollapsed: (collapsed: boolean) => void;
}

export const useMapSidebarStore = create<MapSidebarState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      gmPanelCollapsed: false,
      compendiumCollapsed: false,
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      toggleSidebarCollapsed: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setGmPanelCollapsed: (gmPanelCollapsed) => set({ gmPanelCollapsed }),
      setCompendiumCollapsed: (compendiumCollapsed) => set({ compendiumCollapsed }),
    }),
    { name: 'grimoire-map-sidebar' },
  ),
);

const RAIL_WIDTH = 36;
const COLUMN_WIDTH = 220;

export function mapSidebarWidth(
  sidebarCollapsed: boolean,
  gmPanelCollapsed: boolean,
  compendiumCollapsed: boolean,
): number {
  if (sidebarCollapsed) return RAIL_WIDTH;
  const gmOpen = !gmPanelCollapsed;
  const compOpen = !compendiumCollapsed;
  if (!gmOpen && !compOpen) return RAIL_WIDTH;
  if (gmOpen && compOpen) return COLUMN_WIDTH * 2;
  return COLUMN_WIDTH;
}
