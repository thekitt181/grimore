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

export const MAP_SIDEBAR_RAIL_WIDTH = 36;
export const MAP_SIDEBAR_COLUMN_WIDTH = 220;

export function mapSidebarWidth(
  sidebarCollapsed: boolean,
  gmPanelCollapsed: boolean,
  compendiumCollapsed: boolean,
): number {
  if (sidebarCollapsed) return MAP_SIDEBAR_RAIL_WIDTH;
  const gmW = gmPanelCollapsed ? MAP_SIDEBAR_RAIL_WIDTH : MAP_SIDEBAR_COLUMN_WIDTH;
  // Reserve full compendium column width when minimized so the map does not expand.
  void compendiumCollapsed;
  const compW = MAP_SIDEBAR_COLUMN_WIDTH;
  return gmW + compW;
}
