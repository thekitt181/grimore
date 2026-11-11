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
      compendiumCollapsed: true,
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      toggleSidebarCollapsed: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setGmPanelCollapsed: (gmPanelCollapsed) => set({ gmPanelCollapsed }),
      setCompendiumCollapsed: (compendiumCollapsed) => set({ compendiumCollapsed }),
    }),
    { name: 'grimoire-map-sidebar-v2' },
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
  const compW = compendiumCollapsed ? MAP_SIDEBAR_RAIL_WIDTH : MAP_SIDEBAR_COLUMN_WIDTH;
  return gmW + compW;
}
