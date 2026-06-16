import { create } from 'zustand';
import { requestFogRepaint } from '@/systems/map/fogRepaintBridge';
import { persistFogScene } from '@/systems/scene/fogSync';
import { clampView2dMiniOrbitAzimuth } from '@/systems/map3d/tableMiniOrbit';

// ─── Scene-level state ──────────────────────────────────────────────────────────
//
// After the unified-item rebuild, all canvas objects live in `itemStore`.
// This store now only holds *scene-level* concerns that are not per-item:
//   - the active tool
//   - the pan/zoom viewport
//   - fog-of-war reveal state
//   - shared drawing colour / stroke
//   - a flat mirror of the active map's grid (so fog/measure/viewport hooks
//     can read grid dimensions without reaching into itemStore).

export type GridType = 'square' | 'hex';

export type MapTool =
  | 'select' | 'pan'
  | 'fog-reveal' | 'fog-hide'
  | 'wall'
  | 'measure'
  | 'calibrate'
  | 'draw-freehand' | 'draw-rect' | 'draw-circle' | 'draw-arrow' | 'text' | 'eraser';

export type MapViewMode = '2d' | '3d';

export type WallMode = 'freehand' | 'rect' | 'circle' | 'eraser';

export interface MapViewport {
  x: number;
  y: number;
  scale: number;
}

/** Spherical orbit around the map center in 3D view (radians). */
export interface View3DOrbit {
  /** Rotation around vertical axis — full 360°. */
  azimuth: number;
  /** Angle from top-down (0) toward horizon (π/2). */
  polar: number;
}

/** Manual orbit for GLB minis on the 2D map (right-drag when selected). */
export interface View2DMiniOrbit {
  /** Offset from default tabletop azimuth — capped to ±90°. */
  azimuth: number;
}

export const DEFAULT_VIEW3D_ORBIT: View3DOrbit = {
  azimuth: Math.PI / 4,
  polar: 0.95,
};

export const DEFAULT_VIEW2D_MINI_ORBIT: View2DMiniOrbit = {
  azimuth: 0,
};

const POLAR_MIN = 0.12;
const POLAR_MAX = Math.PI / 2 - 0.05;

export function clampView3dOrbit(orbit: View3DOrbit): View3DOrbit {
  return {
    azimuth: orbit.azimuth,
    polar: Math.max(POLAR_MIN, Math.min(POLAR_MAX, orbit.polar)),
  };
}

export interface ActiveGrid {
  gridType: GridType;
  gridSize: number;
  mapWidth: number;
  mapHeight: number;
  gridColor: number;
  gridOpacity: number;
  gridOffsetX: number;
  gridOffsetY: number;
  showGrid: boolean;
  /** World origin of the active map (top-left). */
  mapX: number;
  mapY: number;
}

interface SceneState extends ActiveGrid {
  activeTool: MapTool;
  viewport: MapViewport;

  /** 2D Pixi canvas vs 3D orbit view (React Three Fiber). */
  viewMode: MapViewMode;
  /** 3D camera orbit (right-drag or Alt+drag in 3D view). */
  view3dOrbit: View3DOrbit;
  /** 2D GLB mini view orbit (right-drag when a model token is selected). */
  view2dMiniOrbit: View2DMiniOrbit;
  /** Saved 2D orbit angle per GLB token id (persists across deselect). */
  miniOrbitByTokenId: Record<string, number>;
  /** Saved 3D camera orbit per token id (persists across deselect). */
  miniOrbit3dByTokenId: Record<string, View3DOrbit>;
  /** Auto-extrude wall segments into 3D geometry in 3D mode. */
  autoExtrudeWalls: boolean;
  /** Wall height in grid cells (~5 ft per cell). */
  wallHeightCells: number;

  // Fog
  revealedCells: Set<string>;
  /** Bumped on every fog mutation so overlays repaint without a user click. */
  fogRevision: number;
  fogBrushSize: number;
  /** GM prep mode — when false the fog overlay is hidden (map fully visible). */
  fogEnabled: boolean;
  /** Session-wide fog active (synced from GM). Players hide fog when false. */
  sessionFogActive: boolean;

  /** GM: push map select / reset view to players. */
  syncPlayerViews: boolean;
  /** GM: allow dragging tokens assigned to players. */
  gmMovePlayerTokens: boolean;
  /** When false, only the GM can move tokens. */
  playersCanMoveTokens: boolean;

  // Drawing tool settings
  drawColor: string;
  drawStroke: number;
  textFontSize: number;

  /** Sub-mode when activeTool is wall. */
  wallMode: WallMode;

  // ── Actions ────────────────────────────────────────────────────────────────
  setTool: (tool: MapTool) => void;
  setWallMode: (mode: WallMode) => void;
  setViewport: (vp: MapViewport) => void;
  setFogBrushSize: (size: number) => void;
  setFogEnabled: (enabled: boolean) => void;
  setSessionFogActive: (active: boolean) => void;
  setSyncPlayerViews: (enabled: boolean) => void;
  setGmMovePlayerTokens: (enabled: boolean) => void;
  setPlayersCanMoveTokens: (enabled: boolean) => void;
  setDrawColor: (color: string) => void;
  setDrawStroke: (stroke: number) => void;
  setTextFontSize: (size: number) => void;

  /** Auto-detect walls from map image darkness for 3D extrusion. */
  scanImageWalls: boolean;
  /** Luminance threshold for image wall scan (lower = more walls). */
  wallScanThreshold: number;

  setViewMode: (mode: MapViewMode) => void;
  toggleViewMode: () => void;
  adjustView3dOrbit: (deltaAzimuth: number, deltaPolar: number, tokenId?: string) => void;
  setView3dOrbit: (orbit: View3DOrbit) => void;
  saveMiniOrbit3dForToken: (tokenId: string, orbit: View3DOrbit) => void;
  getMiniOrbit3dForToken: (tokenId: string) => View3DOrbit;
  resetView3dOrbit: () => void;
  adjustView2dMiniOrbit: (deltaAzimuth: number, tokenId?: string) => void;
  setView2dMiniOrbitAzimuth: (azimuth: number) => void;
  saveMiniOrbitForToken: (tokenId: string, azimuth: number) => void;
  getMiniOrbitForToken: (tokenId: string) => number;
  resetView2dMiniOrbit: () => void;
  setAutoExtrudeWalls: (enabled: boolean) => void;
  setWallHeightCells: (cells: number) => void;
  setScanImageWalls: (enabled: boolean) => void;
  setWallScanThreshold: (threshold: number) => void;

  setActiveGrid: (grid: Partial<ActiveGrid>) => void;

  revealCell: (key: string) => void;
  applyFogCells: (keys: string[], mode: 'reveal' | 'hide') => void;
  hideCell: (key: string) => void;
  revealAll: () => void;
  hideAll: () => void;
  setRevealedCells: (cells: Set<string>, options?: { persist?: boolean }) => void;

  reset: () => void;
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

export function cellKey(x: number, y: number): string { return `${x},${y}`; }

const DEFAULT_GRID_SIZE  = 96;
const DEFAULT_MAP_WIDTH  = 2560;
const DEFAULT_MAP_HEIGHT = 1920;

const DEFAULT_GRID: ActiveGrid = {
  gridType:    'square',
  gridSize:    DEFAULT_GRID_SIZE,
  mapWidth:    DEFAULT_MAP_WIDTH,
  mapHeight:   DEFAULT_MAP_HEIGHT,
  gridColor:   0x2a2a3a,
  gridOpacity: 0.8,
  gridOffsetX: 0,
  gridOffsetY: 0,
  showGrid:    true,
  mapX:        0,
  mapY:        0,
};

// ─── Store ────────────────────────────────────────────────────────────────────

export const useMapStore = create<SceneState>((set, get) => ({
  ...DEFAULT_GRID,

  activeTool:   'select',
  wallMode:     'freehand',
  viewport:     { x: 0, y: 0, scale: 1 },
  viewMode:     '2d',
  view3dOrbit:    { ...DEFAULT_VIEW3D_ORBIT },
  view2dMiniOrbit: { ...DEFAULT_VIEW2D_MINI_ORBIT },
  miniOrbitByTokenId: {},
  miniOrbit3dByTokenId: {},
  autoExtrudeWalls: false,
  wallHeightCells: 1.8,
  scanImageWalls: false,
  wallScanThreshold: 64,
  revealedCells: new Set<string>(),
  fogRevision: 0,
  fogBrushSize: 2,
  fogEnabled: false,
  sessionFogActive: false,
  syncPlayerViews: false,
  gmMovePlayerTokens: true,
  playersCanMoveTokens: true,
  drawColor:    '#c9a84c',
  drawStroke:   3,
  textFontSize: 18,

  setTool: (activeTool) =>
    set((s) => {
      const fogTool = activeTool === 'fog-reveal' || activeTool === 'fog-hide';
      const fogEnabled = s.fogEnabled || fogTool;
      return {
        activeTool,
        fogEnabled,
        sessionFogActive: fogTool ? true : s.sessionFogActive,
      };
    }),
  setWallMode: (wallMode) => set({ wallMode }),
  setViewport:    (viewport) => set({ viewport }),
  setFogBrushSize:(fogBrushSize) => set({ fogBrushSize }),
  setFogEnabled: (fogEnabled) => {
    set((s) => ({ fogEnabled, fogRevision: s.fogRevision + 1 }));
    requestFogRepaint();
  },
  setSessionFogActive: (sessionFogActive) => {
    set((s) => ({ sessionFogActive, fogRevision: s.fogRevision + 1 }));
    requestFogRepaint();
  },
  setSyncPlayerViews: (syncPlayerViews) => set({ syncPlayerViews }),
  setGmMovePlayerTokens: (gmMovePlayerTokens) => set({ gmMovePlayerTokens }),
  setPlayersCanMoveTokens: (playersCanMoveTokens) => set({ playersCanMoveTokens }),
  setDrawColor:   (drawColor) => set({ drawColor }),
  setDrawStroke:  (drawStroke) => set({ drawStroke }),
  setTextFontSize:(textFontSize) => set({ textFontSize }),

  setViewMode: (viewMode) => set({ viewMode }),
  toggleViewMode: () =>
    set((s) => ({ viewMode: s.viewMode === '2d' ? '3d' : '2d' })),
  adjustView3dOrbit: (deltaAzimuth, deltaPolar, tokenId) =>
    set((s) => {
      const orbit = clampView3dOrbit({
        azimuth: s.view3dOrbit.azimuth + deltaAzimuth,
        polar: s.view3dOrbit.polar + deltaPolar,
      });
      return {
        view3dOrbit: orbit,
        ...(tokenId
          ? { miniOrbit3dByTokenId: { ...s.miniOrbit3dByTokenId, [tokenId]: orbit } }
          : {}),
      };
    }),
  setView3dOrbit: (orbit) => set({ view3dOrbit: clampView3dOrbit(orbit) }),
  saveMiniOrbit3dForToken: (tokenId, orbit) =>
    set((s) => ({
      miniOrbit3dByTokenId: {
        ...s.miniOrbit3dByTokenId,
        [tokenId]: clampView3dOrbit(orbit),
      },
    })),
  getMiniOrbit3dForToken: (tokenId) =>
    get().miniOrbit3dByTokenId[tokenId] ?? { ...DEFAULT_VIEW3D_ORBIT },
  resetView3dOrbit: () =>
    set({ view3dOrbit: { ...DEFAULT_VIEW3D_ORBIT }, miniOrbit3dByTokenId: {} }),
  adjustView2dMiniOrbit: (deltaAzimuth, tokenId) =>
    set((s) => {
      const azimuth = clampView2dMiniOrbitAzimuth(s.view2dMiniOrbit.azimuth + deltaAzimuth);
      return {
        view2dMiniOrbit: { azimuth },
        ...(tokenId
          ? { miniOrbitByTokenId: { ...s.miniOrbitByTokenId, [tokenId]: azimuth } }
          : {}),
      };
    }),
  setView2dMiniOrbitAzimuth: (azimuth) =>
    set({ view2dMiniOrbit: { azimuth: clampView2dMiniOrbitAzimuth(azimuth) } }),
  saveMiniOrbitForToken: (tokenId, azimuth) =>
    set((s) => ({
      miniOrbitByTokenId: {
        ...s.miniOrbitByTokenId,
        [tokenId]: clampView2dMiniOrbitAzimuth(azimuth),
      },
    })),
  getMiniOrbitForToken: (tokenId) => get().miniOrbitByTokenId[tokenId] ?? 0,
  resetView2dMiniOrbit: () =>
    set({ view2dMiniOrbit: { ...DEFAULT_VIEW2D_MINI_ORBIT }, miniOrbitByTokenId: {} }),
  setAutoExtrudeWalls: (autoExtrudeWalls) => set({ autoExtrudeWalls }),
  setWallHeightCells: (wallHeightCells) =>
    set({ wallHeightCells: Math.max(0.5, Math.min(8, wallHeightCells)) }),
  setScanImageWalls: (scanImageWalls) => set({ scanImageWalls }),
  setWallScanThreshold: (wallScanThreshold) =>
    set({ wallScanThreshold: Math.max(50, Math.min(180, wallScanThreshold)) }),

  setActiveGrid:  (grid) => set((s) => ({ ...s, ...grid })),

  revealCell: (key) => {
    set((s) => {
      const n = new Set(s.revealedCells);
      n.add(key);
      return { revealedCells: n, fogRevision: s.fogRevision + 1 };
    });
    persistFogScene();
    requestFogRepaint();
  },

  applyFogCells: (keys, mode) => {
    if (keys.length === 0) return;
    set((s) => {
      const n = new Set(s.revealedCells);
      for (const key of keys) {
        if (mode === 'reveal') n.add(key);
        else n.delete(key);
      }
      return { revealedCells: n, fogRevision: s.fogRevision + 1 };
    });
    persistFogScene();
    requestFogRepaint();
  },

  hideCell: (key) => {
    set((s) => {
      const n = new Set(s.revealedCells);
      n.delete(key);
      return { revealedCells: n, fogRevision: s.fogRevision + 1 };
    });
    persistFogScene();
    requestFogRepaint();
  },

  revealAll: () => {
    set((s) => {
      const cols = Math.ceil(s.mapWidth / s.gridSize);
      const rows = Math.ceil(s.mapHeight / s.gridSize);
      const all = new Set<string>();
      for (let x = 0; x < cols; x++)
        for (let y = 0; y < rows; y++)
          all.add(cellKey(x, y));
      return { revealedCells: all, fogRevision: s.fogRevision + 1 };
    });
    persistFogScene();
    requestFogRepaint();
  },

  hideAll: () => {
    set((s) => ({ revealedCells: new Set<string>(), fogRevision: s.fogRevision + 1 }));
    persistFogScene();
    requestFogRepaint();
  },

  setRevealedCells: (revealedCells, options) => {
    set((s) => ({ revealedCells, fogRevision: s.fogRevision + 1 }));
    if (options?.persist !== false) {
      persistFogScene({ pushServer: false });
    }
    requestFogRepaint();
  },

  reset: () =>
    set({
      ...DEFAULT_GRID,
      activeTool: 'select',
      wallMode: 'freehand',
      viewport: { x: 0, y: 0, scale: 1 },
      viewMode: '2d',
      view3dOrbit: { ...DEFAULT_VIEW3D_ORBIT },
      view2dMiniOrbit: { ...DEFAULT_VIEW2D_MINI_ORBIT },
      miniOrbitByTokenId: {},
      miniOrbit3dByTokenId: {},
      autoExtrudeWalls: false,
      wallHeightCells: 1.8,
      scanImageWalls: false,
      wallScanThreshold: 64,
      revealedCells: new Set<string>(),
      fogRevision: 0,
      fogEnabled: false,
      sessionFogActive: false,
      syncPlayerViews: false,
      gmMovePlayerTokens: true,
      playersCanMoveTokens: true,
    }),
}));
