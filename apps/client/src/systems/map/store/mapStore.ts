import { create } from 'zustand';
import { persistFogScene } from '@/systems/scene/fogSync';

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

export const DEFAULT_VIEW3D_ORBIT: View3DOrbit = {
  azimuth: Math.PI / 4,
  polar: 0.95,
};

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
  /** Auto-extrude wall segments into 3D geometry in 3D mode. */
  autoExtrudeWalls: boolean;
  /** Wall height in grid cells (~5 ft per cell). */
  wallHeightCells: number;

  // Fog
  revealedCells: Set<string>;
  fogBrushSize: number;
  /** GM prep mode — when false the fog overlay is hidden (map fully visible). */
  fogEnabled: boolean;
  /** Session-wide fog active (synced from GM). Players hide fog when false. */
  sessionFogActive: boolean;

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
  setDrawColor: (color: string) => void;
  setDrawStroke: (stroke: number) => void;
  setTextFontSize: (size: number) => void;

  /** Auto-detect walls from map image darkness for 3D extrusion. */
  scanImageWalls: boolean;
  /** Luminance threshold for image wall scan (lower = more walls). */
  wallScanThreshold: number;

  setViewMode: (mode: MapViewMode) => void;
  toggleViewMode: () => void;
  adjustView3dOrbit: (deltaAzimuth: number, deltaPolar: number) => void;
  resetView3dOrbit: () => void;
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

export const useMapStore = create<SceneState>((set) => ({
  ...DEFAULT_GRID,

  activeTool:   'select',
  wallMode:     'freehand',
  viewport:     { x: 0, y: 0, scale: 1 },
  viewMode:     '2d',
  view3dOrbit:    { ...DEFAULT_VIEW3D_ORBIT },
  autoExtrudeWalls: false,
  wallHeightCells: 1.8,
  scanImageWalls: false,
  wallScanThreshold: 64,
  revealedCells: new Set<string>(),
  fogBrushSize: 2,
  fogEnabled: false,
  sessionFogActive: false,
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
  setFogEnabled:  (fogEnabled) => set({ fogEnabled }),
  setSessionFogActive: (sessionFogActive) => set({ sessionFogActive }),
  setDrawColor:   (drawColor) => set({ drawColor }),
  setDrawStroke:  (drawStroke) => set({ drawStroke }),
  setTextFontSize:(textFontSize) => set({ textFontSize }),

  setViewMode: (viewMode) => set({ viewMode }),
  toggleViewMode: () =>
    set((s) => ({ viewMode: s.viewMode === '2d' ? '3d' : '2d' })),
  adjustView3dOrbit: (deltaAzimuth, deltaPolar) =>
    set((s) => {
      const polarMin = 0.12;
      const polarMax = Math.PI / 2 - 0.05;
      return {
        view3dOrbit: {
          azimuth: s.view3dOrbit.azimuth + deltaAzimuth,
          polar: Math.max(polarMin, Math.min(polarMax, s.view3dOrbit.polar + deltaPolar)),
        },
      };
    }),
  resetView3dOrbit: () => set({ view3dOrbit: { ...DEFAULT_VIEW3D_ORBIT } }),
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
      return { revealedCells: n };
    });
    persistFogScene();
  },

  applyFogCells: (keys, mode) => {
    if (keys.length === 0) return;
    set((s) => {
      const n = new Set(s.revealedCells);
      for (const key of keys) {
        if (mode === 'reveal') n.add(key);
        else n.delete(key);
      }
      return { revealedCells: n };
    });
    persistFogScene();
  },

  hideCell: (key) => {
    set((s) => {
      const n = new Set(s.revealedCells);
      n.delete(key);
      return { revealedCells: n };
    });
    persistFogScene();
  },

  revealAll: () => {
    set((s) => {
      const cols = Math.ceil(s.mapWidth / s.gridSize);
      const rows = Math.ceil(s.mapHeight / s.gridSize);
      const all = new Set<string>();
      for (let x = 0; x < cols; x++)
        for (let y = 0; y < rows; y++)
          all.add(cellKey(x, y));
      return { revealedCells: all };
    });
    persistFogScene();
  },

  hideAll: () => {
    set({ revealedCells: new Set<string>() });
    persistFogScene();
  },

  setRevealedCells: (revealedCells, options) => {
    set({ revealedCells });
    if (options?.persist !== false) {
      persistFogScene({ pushServer: false });
    }
  },

  reset: () =>
    set({
      ...DEFAULT_GRID,
      activeTool: 'select',
      wallMode: 'freehand',
      viewport: { x: 0, y: 0, scale: 1 },
      viewMode: '2d',
      view3dOrbit: { ...DEFAULT_VIEW3D_ORBIT },
      autoExtrudeWalls: false,
      wallHeightCells: 1.8,
      scanImageWalls: false,
      wallScanThreshold: 64,
      revealedCells: new Set<string>(),
      fogEnabled: false,
      sessionFogActive: false,
    }),
}));
