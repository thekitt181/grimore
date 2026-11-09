import type { MapItem } from '@/systems/scene/types';
import { DEFAULT_MAP_GRID_SIZE } from '@/systems/scene/types';

/** 1 authored mesh-meter = 1 grid cell on the board (Kenney and KayKit share this). */
export const MODULAR_PX_PER_UNIT = DEFAULT_MAP_GRID_SIZE;
export const MODULAR_SNAP_REV = 45;

export type Cardinal = 'N' | 'E' | 'S' | 'W';
export type KitId = 'kenney' | 'kaykit';

export type ModularPiece = {
  kit: KitId;
  /** Filename without extension */
  key: string;
  title: string;
  url: string;
  /** Visual mesh meters (X → width, Z → height) at MAP_MODEL_YAW = 180°. */
  w: number;
  h: number;
  /**
   * Snap/item footprint. Stairs include a 0.2 m lip outside the 4×8 module —
   * join uses the module so the ledge tucks into the neighboring opening.
   */
  joinW?: number;
  joinH?: number;
  openings: Cardinal[];
  kind: 'room' | 'hall' | 'gate' | 'tile' | 'wall' | 'stairs';
  /** GLB clip names and/or mesh node to swing. */
  anim?: { clips?: boolean; doorNode?: string };
};

const ALL: Cardinal[] = ['N', 'E', 'S', 'W'];

function kenney(
  key: string,
  title: string,
  modelX: number,
  modelZ: number,
  openings: Cardinal[],
  kind: ModularPiece['kind'],
  extra?: { anim?: ModularPiece['anim']; joinW?: number; joinH?: number },
): ModularPiece {
  return {
    kit: 'kenney',
    key,
    title,
    url: `/maps3d/kenney/${key}.glb`,
    w: modelX,
    h: modelZ,
    openings,
    kind,
    ...(extra?.joinW != null ? { joinW: extra.joinW } : {}),
    ...(extra?.joinH != null ? { joinH: extra.joinH } : {}),
    ...(extra?.anim ? { anim: extra.anim } : {}),
  };
}

function kaykit(
  key: string,
  title: string,
  modelX: number,
  modelZ: number,
  openings: Cardinal[],
  kind: ModularPiece['kind'],
  extra?: { anim?: ModularPiece['anim']; joinW?: number; joinH?: number },
): ModularPiece {
  return {
    kit: 'kaykit',
    key,
    title,
    url: `/maps3d/kaykit/${key}.glb`,
    w: modelX,
    h: modelZ,
    openings,
    kind,
    ...(extra?.joinW != null ? { joinW: extra.joinW } : {}),
    ...(extra?.joinH != null ? { joinH: extra.joinH } : {}),
    ...(extra?.anim ? { anim: extra.anim } : {}),
  };
}

/** Kenney True Modular rooms/halls (CC0). Openings at rotation 0 after yaw. */
export const KENNEY_PIECES: ModularPiece[] = [
  kenney('corridor', 'Corridor', 4, 4, ['E', 'W'], 'hall'),
  kenney('corridor-corner', 'Corridor corner', 4, 4, ['N', 'E'], 'hall'),
  kenney('corridor-end', 'Corridor end', 4, 4, ['S'], 'hall'),
  kenney('corridor-intersection', 'Intersection', 4, 4, ALL, 'hall'),
  kenney('corridor-junction', 'Junction', 4, 4, ['N', 'E', 'W'], 'hall'),
  kenney('corridor-transition', 'Corridor transition', 8, 8, ['E', 'W'], 'hall'),
  kenney('corridor-wide', 'Wide corridor', 8, 8, ['E', 'W'], 'hall'),
  kenney('corridor-wide-corner', 'Wide corner', 8, 8, ['N', 'E'], 'hall'),
  kenney('corridor-wide-end', 'Wide end', 8, 8, ['S'], 'hall'),
  kenney('corridor-wide-intersection', 'Wide intersection', 8, 8, ALL, 'hall'),
  kenney('corridor-wide-junction', 'Wide junction', 8, 8, ['N', 'E', 'W'], 'hall'),
  kenney('room-small', 'Small room', 12, 12, ALL, 'room'),
  kenney('room-small-variation', 'Small room · var', 12, 12, ALL, 'room'),
  kenney('room-corner', 'Corner room', 12, 12, ['N', 'E'], 'room'),
  kenney('room-large', 'Large room', 20, 20, ALL, 'room'),
  kenney('room-large-variation', 'Large room · var', 20, 20, ALL, 'room'),
  kenney('room-wide', 'Wide room', 20, 12, ALL, 'room'),
  kenney('room-wide-variation', 'Wide room · var', 20, 12, ALL, 'room'),
  kenney('stairs', 'Stairs', 4.4, 8.4, ['N', 'S'], 'stairs', { joinW: 4, joinH: 8 }),
  kenney('stairs-wide', 'Wide stairs', 8.4, 8.4, ['N', 'S'], 'stairs', { joinW: 8, joinH: 8 }),
  kenney('gate', 'Gate', 4.4, 2, ['E', 'W'], 'gate', { anim: { doorNode: 'gate' } }),
  kenney('gate-door', 'Gate · door', 5.2, 2, ['E', 'W'], 'gate', { anim: { clips: true, doorNode: 'door' } }),
  kenney('gate-door-window', 'Gate · window', 5.2, 2, ['E', 'W'], 'gate', { anim: { clips: true, doorNode: 'door' } }),
  kenney('gate-metal-bars', 'Gate · bars', 4.4, 2, ['E', 'W'], 'gate', { anim: { doorNode: 'gate' } }),
  kenney('template-floor', 'Floor 4 m', 4, 4, ALL, 'tile'),
  kenney('template-floor-big', 'Floor 8 m', 8, 8, ALL, 'tile'),
  kenney('template-floor-layer', 'Floor layer', 4, 4, ALL, 'tile'),
  kenney('template-floor-layer-raised', 'Floor raised', 4, 4, ALL, 'tile'),
  kenney('template-floor-layer-hole', 'Floor hole', 4, 4, ALL, 'tile'),
  kenney('template-floor-detail', 'Floor detail', 4, 4, ALL, 'tile'),
  kenney('template-floor-detail-a', 'Floor detail A', 4, 4, ALL, 'tile'),
  kenney('template-wall', 'Wall', 4, 2, ['N', 'S'], 'wall'),
  kenney('template-wall-half', 'Wall half', 2, 1.8, ['N', 'S'], 'wall'),
  kenney('template-wall-corner', 'Wall corner', 2, 2, ['E', 'S'], 'wall'),
  kenney('template-wall-top', 'Wall top', 4, 0.6, ['N', 'S'], 'wall'),
  kenney('template-wall-stairs', 'Wall stairs', 4, 0.63, ['N', 'S'], 'wall'),
  kenney('template-wall-detail-a', 'Wall detail', 4, 2, ['N', 'S'], 'wall'),
  kenney('template-corner', 'Module corner', 4, 4, ['N', 'E'], 'hall'),
  kenney('template-detail', 'Column detail', 1.8, 1.8, ALL, 'wall'),
];

/** KayKit dungeon structure (CC0). Walls ~4 m, floors 2 m. */
export const KAYKIT_PIECES: ModularPiece[] = [
  kaykit('wall', 'Wall', 4, 1, ['N', 'S'], 'wall'),
  kaykit('wall_half', 'Wall half', 2, 1, ['N', 'S'], 'wall'),
  kaykit('wall_broken', 'Broken wall', 4, 1, ['N', 'S'], 'wall'),
  kaykit('wall_cracked', 'Cracked wall', 4, 1.26, ['N', 'S'], 'wall'),
  kaykit('wall_sloped', 'Sloped wall', 4, 1, ['N', 'S'], 'wall'),
  kaykit('wall_scaffold', 'Scaffold wall', 4, 1, ['N', 'S'], 'wall'),
  kaykit('wall_open_scaffold', 'Open scaffold', 4, 1, ['N', 'S'], 'wall'),
  kaykit('wall_shelves', 'Shelves', 4, 1.37, ['N', 'S'], 'wall'),
  kaykit('wall_pillar', 'Wall + pillar', 4, 1.5, ['N', 'S'], 'wall'),
  kaykit('wall_arched', 'Arched wall', 4, 1, ['N', 'S'], 'wall'),
  kaykit('wall_corner', 'Wall corner', 2.5, 2.5, ['E', 'S'], 'wall'),
  kaykit('wall_corner_gated', 'Corner gated', 2.5, 2.5, ['E', 'S'], 'wall'),
  kaykit('wall_corner_scaffold', 'Corner scaffold', 2.5, 2.5, ['E', 'S'], 'wall'),
  kaykit('wall_corner_small', 'Corner small', 1.5, 1.5, ['E', 'S'], 'wall'),
  kaykit('wall_endcap', 'Wall end', 1.07, 1, ['S'], 'wall'),
  kaykit('wall_half_endcap', 'Half end', 2, 1, ['S'], 'wall'),
  kaykit('wall_half_endcap_sloped', 'Half end sloped', 2, 1, ['S'], 'wall'),
  kaykit('wall_Tsplit', 'Wall T', 4, 2.5, ['N', 'E', 'W'], 'wall'),
  kaykit('wall_Tsplit_sloped', 'Wall T sloped', 4, 2.5, ['N', 'E', 'W'], 'wall'),
  kaykit('wall_crossing', 'Wall cross', 4, 4, ALL, 'wall'),
  kaykit('wall_doorway', 'Doorway', 4, 1, ['N', 'S'], 'wall', { anim: { doorNode: 'wall_doorway_door' } }),
  kaykit('wall_doorway_scaffold', 'Doorway · scaffold', 4, 1, ['N', 'S'], 'wall', {
    anim: { doorNode: 'wall_doorway_scaffold_door' },
  }),
  kaykit('wall_doorway_Tsplit', 'Doorway T', 8, 2.5, ['N', 'E', 'W'], 'wall'),
  kaykit('wall_doorway_sides', 'Doorway sides', 5, 4, ['E', 'W'], 'wall'),
  kaykit('wall_gated', 'Gated wall', 4, 1, ['N', 'S'], 'wall'),
  kaykit('wall_window_open', 'Window', 4, 1, ['N', 'S'], 'wall'),
  kaykit('wall_window_open_scaffold', 'Window · scaffold', 4, 1, ['N', 'S'], 'wall'),
  kaykit('wall_window_closed', 'Window closed', 4, 1, ['N', 'S'], 'wall'),
  kaykit('wall_window_closed_scaffold', 'Window closed · scaffold', 4, 1, ['N', 'S'], 'wall'),
  kaykit('wall_archedwindow_open', 'Arch window', 4, 1, ['N', 'S'], 'wall'),
  kaykit('wall_archedwindow_gated', 'Arch gated', 4, 1, ['N', 'S'], 'wall'),
  kaykit('wall_archedwindow_gated_scaffold', 'Arch gated · scaffold', 4, 1, ['N', 'S'], 'wall'),
  kaykit('floor_tile_small', 'Floor 2 m', 2, 2, ALL, 'tile'),
  kaykit('floor_tile_small_broken_A', 'Floor 2 m broken A', 2, 2, ALL, 'tile'),
  kaykit('floor_tile_small_broken_B', 'Floor 2 m broken B', 2, 2, ALL, 'tile'),
  kaykit('floor_tile_small_corner', 'Floor 2 m corner', 2, 2, ALL, 'tile'),
  kaykit('floor_tile_small_decorated', 'Floor 2 m decorated', 2, 2, ALL, 'tile'),
  kaykit('floor_tile_small_weeds_A', 'Floor 2 m weeds A', 2, 2, ALL, 'tile'),
  kaykit('floor_tile_small_weeds_B', 'Floor 2 m weeds B', 2, 2, ALL, 'tile'),
  kaykit('floor_tile_large', 'Floor 4 m', 4, 4, ALL, 'tile'),
  kaykit('floor_tile_large_rocks', 'Floor 4 m rocks', 4, 4, ALL, 'tile'),
  kaykit('floor_tile_grate', 'Grate 4×2', 4, 2, ALL, 'tile'),
  kaykit('floor_tile_grate_open', 'Grate open 4×2', 4, 2, ALL, 'tile'),
  kaykit('floor_tile_big_grate', 'Grate 4 m', 4, 4, ALL, 'tile'),
  kaykit('floor_tile_big_grate_open', 'Grate open 4 m', 4, 4, ALL, 'tile'),
  kaykit('floor_tile_big_spikes', 'Spikes', 2.2, 2.2, ALL, 'tile', { joinW: 2, joinH: 2 }),
  kaykit('floor_tile_extralarge_grates', 'Grate 8 m', 8, 8, ALL, 'tile'),
  kaykit('floor_tile_extralarge_grates_open', 'Grate open 8 m', 8, 8, ALL, 'tile'),
  kaykit('floor_dirt_small_A', 'Dirt 2 m A', 2, 2, ALL, 'tile'),
  kaykit('floor_dirt_small_B', 'Dirt 2 m B', 2, 2, ALL, 'tile'),
  kaykit('floor_dirt_small_C', 'Dirt 2 m C', 2, 2, ALL, 'tile'),
  kaykit('floor_dirt_small_D', 'Dirt 2 m D', 2, 2, ALL, 'tile'),
  kaykit('floor_dirt_small_corner', 'Dirt 2 m corner', 2, 2, ALL, 'tile'),
  kaykit('floor_dirt_small_weeds', 'Dirt 2 m weeds', 2, 2, ALL, 'tile'),
  kaykit('floor_dirt_large', 'Dirt 4 m', 4, 4, ALL, 'tile'),
  kaykit('floor_dirt_large_rocky', 'Dirt 4 m rocky', 4, 4, ALL, 'tile'),
  kaykit('floor_wood_small', 'Wood 2 m', 2, 2, ALL, 'tile'),
  kaykit('floor_wood_small_dark', 'Wood 2 m dark', 2, 2, ALL, 'tile'),
  kaykit('floor_wood_large', 'Wood 4 m', 4, 4, ALL, 'tile'),
  kaykit('floor_wood_large_dark', 'Wood 4 m dark', 4, 4, ALL, 'tile'),
  kaykit('floor_foundation_allsides', 'Foundation', 2.2, 2.2, ALL, 'tile', { joinW: 2, joinH: 2 }),
  kaykit('floor_foundation_front', 'Foundation front', 2, 2.1, ALL, 'tile', { joinW: 2, joinH: 2 }),
  kaykit('floor_foundation_front_and_back', 'Foundation front+back', 2, 2.2, ALL, 'tile', { joinW: 2, joinH: 2 }),
  kaykit('floor_foundation_front_and_sides', 'Foundation front+sides', 2.2, 2.1, ALL, 'tile', { joinW: 2, joinH: 2 }),
  kaykit('floor_foundation_corner', 'Foundation corner', 2.1, 2.1, ALL, 'tile', { joinW: 2, joinH: 2 }),
  kaykit('floor_foundation_diagonal_corner', 'Foundation diagonal', 2.1, 2.1, ALL, 'tile', { joinW: 2, joinH: 2 }),
  kaykit('stairs', 'Stairs', 5, 4, ['E', 'W'], 'stairs'),
  kaykit('stairs_wide', 'Wide stairs', 7, 4, ['E', 'W'], 'stairs'),
  kaykit('stairs_narrow', 'Narrow stairs', 4, 4, ['N', 'S'], 'stairs'),
  kaykit('stairs_walled', 'Walled stairs', 5, 4, ['E', 'W'], 'stairs'),
  kaykit('stairs_wall_left', 'Stairs wall left', 4, 5, ['N', 'S'], 'stairs'),
  kaykit('stairs_wall_right', 'Stairs wall right', 4, 5, ['N', 'S'], 'stairs'),
  kaykit('stairs_wood', 'Wood stairs', 3.3, 6, ['N', 'S'], 'stairs'),
  kaykit('stairs_wood_decorated', 'Wood stairs decorated', 3.3, 6, ['N', 'S'], 'stairs'),
  kaykit('barrier', 'Barrier', 4, 0.5, ['N', 'S'], 'wall'),
  kaykit('barrier_half', 'Barrier half', 2, 0.5, ['N', 'S'], 'wall'),
  kaykit('barrier_column', 'Barrier + column', 4, 0.7, ['N', 'S'], 'wall'),
  kaykit('barrier_colum_half', 'Barrier column half', 2.35, 0.7, ['N', 'S'], 'wall'),
  kaykit('barrier_corner', 'Barrier corner', 2.4, 2.4, ['E', 'S'], 'wall'),
  kaykit('column', 'Column', 0.7, 0.7, ALL, 'wall'),
  kaykit('pillar', 'Pillar', 1.5, 1.5, ALL, 'wall'),
  kaykit('pillar_decorated', 'Pillar decorated', 2.23, 1.71, ALL, 'wall'),
];

export const ALL_MODULAR_PIECES: ModularPiece[] = [...KENNEY_PIECES, ...KAYKIT_PIECES];

const BY_URL = new Map(ALL_MODULAR_PIECES.map((p) => [p.url, p]));

export function pieceForUrl(url: string | null | undefined): ModularPiece | null {
  if (!url) return null;
  const path = url.split('?')[0] ?? url;
  const hit = BY_URL.get(path) ?? BY_URL.get(url);
  if (hit) return hit;
  return ALL_MODULAR_PIECES.find((p) => path.endsWith(p.url) || path.includes(`/${p.kit}/${p.key}.glb`)) ?? null;
}

export function isModularMap(map: Pick<MapItem, 'modelUrl'> | null | undefined): boolean {
  return pieceForUrl(map?.modelUrl) != null;
}

export function isModularWall(map: Pick<MapItem, 'modelUrl'> | null | undefined): boolean {
  const k = pieceForUrl(map?.modelUrl)?.kind;
  return k === 'wall' || k === 'gate';
}

/** Higher wins when several maps overlap the click: unlocked, then walls, then smaller. */
export function mapPickRank(it: Pick<MapItem, 'width' | 'height' | 'locked' | 'zIndex' | 'modelUrl'>): number {
  const p = pieceForUrl(it.modelUrl);
  const kind =
    p?.kind === 'gate' || p?.kind === 'wall' ? 4
    : p?.kind === 'stairs' ? 3
    : p?.kind === 'tile' ? 2
    : 1;
  const area = Math.max(1, it.width * it.height);
  return (it.locked ? 0 : 1_000_000_000) + kind * 10_000_000 + (it.zIndex ?? 0) * 1_000 - area;
}

export function isModularGate(map: Pick<MapItem, 'modelUrl'> | null | undefined): boolean {
  const p = pieceForUrl(map?.modelUrl);
  return p?.kind === 'gate' || Boolean(p?.anim?.doorNode) || Boolean(p?.anim?.clips);
}

export function joinMeters(piece: ModularPiece): { w: number; h: number } {
  return {
    w: piece.joinW ?? piece.w,
    h: piece.joinH ?? piece.h,
  };
}

/** Stretch authored mesh XZ to join footprint (walls 1 m → 2 m thick, corners 2.5 → 4). */
export function modularDepthStretch(piece: ModularPiece): number {
  if (piece.kind !== 'wall') return 1;
  const j = joinMeters(piece);
  if (piece.h < 1e-6) return 1;
  return Math.max(1, j.h / piece.h);
}

export function modularWidthStretch(piece: ModularPiece): number {
  if (piece.kind !== 'wall') return 1;
  const j = joinMeters(piece);
  if (piece.w < 1e-6) return 1;
  return Math.max(1, j.w / piece.w);
}

export function footprintPx(piece: ModularPiece, scale = 1): { width: number; height: number } {
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const j = joinMeters(piece);
  return {
    width: Math.max(16, Math.round(j.w * MODULAR_PX_PER_UNIT * s)),
    height: Math.max(16, Math.round(j.h * MODULAR_PX_PER_UNIT * s)),
  };
}

export function modularScaleOf(map: Pick<MapItem, 'width' | 'height' | 'modelUrl'>): number {
  const piece = pieceForUrl(map.modelUrl);
  if (!piece) return 1;
  const base = footprintPx(piece, 1);
  const sx = map.width / base.width;
  const sy = map.height / base.height;
  const s = (sx + sy) / 2;
  if (!Number.isFinite(s) || s <= 0) return 1;
  return Math.max(0.25, Math.min(8, s));
}

/** Snap a modular piece origin onto the 1 m cell grid (centers 1×1 tiles on a cell). */
export function snapModularOriginToGrid(x: number, y: number): { x: number; y: number } {
  const cell = MODULAR_PX_PER_UNIT;
  return {
    x: Math.round(x / cell) * cell,
    y: Math.round(y / cell) * cell,
  };
}

export function modularGridDefaults(): Pick<
  MapItem,
  'gridSize' | 'gridOffsetX' | 'gridOffsetY' | 'showGrid' | 'gridType'
> {
  return {
    gridSize: MODULAR_PX_PER_UNIT,
    gridOffsetX: 0,
    gridOffsetY: 0,
    showGrid: false,
    gridType: 'square',
  };
}

export const CATALOG_SECTIONS: { kind: ModularPiece['kind']; label: string }[] = [
  { kind: 'hall', label: 'Halls' },
  { kind: 'room', label: 'Rooms' },
  { kind: 'wall', label: 'Walls' },
  { kind: 'tile', label: 'Floors' },
  { kind: 'stairs', label: 'Stairs' },
  { kind: 'gate', label: 'Gates' },
];
