// ─── Unified Scene Item model ──────────────────────────────────────────────────
//
// Everything on the canvas (maps, tokens, drawings, text) is an `Item`.
// All items share the same transform (x/y/rotation/width/height), z-order,
// lock/visibility and ownership. Type-specific data lives on each subtype.

export type ItemType = 'map' | 'token' | 'image' | 'handout' | 'drawing' | 'text';

export type GridType = 'square' | 'hex';

export interface WallPoint {
  x: number;
  y: number;
}

/** Line-of-sight blocker in map-local pixels. */
export interface WallSegment {
  a: WallPoint;
  b: WallPoint;
}

/** Default map cell size in pixels at the reference map size below. */
export const DEFAULT_MAP_GRID_SIZE = 96;
export const DEFAULT_MAP_WIDTH = 2560;
export const DEFAULT_MAP_HEIGHT = 1920;

/** Grid cell size for a map so cells look the same on screen when fit-to-view. */
export function gridSizeForMap(width: number, height: number): number {
  const ratio = Math.min(width / DEFAULT_MAP_WIDTH, height / DEFAULT_MAP_HEIGHT);
  return Math.max(4, Math.round(DEFAULT_MAP_GRID_SIZE * ratio));
}

export function defaultMapGrid(width: number, height: number) {
  return { gridSize: gridSizeForMap(width, height), gridOffsetX: 0, gridOffsetY: 0 };
}

export function scaledMapGrid(
  map: Pick<MapItem, 'width' | 'gridSize' | 'gridOffsetX' | 'gridOffsetY'>,
  newWidth: number,
): Pick<MapItem, 'gridSize' | 'gridOffsetX' | 'gridOffsetY'> {
  const scale = newWidth / map.width;
  return {
    gridSize: Math.max(4, Math.round(map.gridSize * scale)),
    gridOffsetX: Math.round(map.gridOffsetX * scale),
    gridOffsetY: Math.round(map.gridOffsetY * scale),
  };
}
export type DrawShape = 'freehand' | 'rect' | 'circle' | 'arrow';

export interface BaseItem {
  id: string;
  type: ItemType;
  /** World position of the item's top-left (pre-rotation) bounding box. */
  x: number;
  y: number;
  /** Rotation in degrees, around the item's center. */
  rotation: number;
  /** Base (un-rotated) size in world pixels. */
  width: number;
  height: number;
  /** Layer ordering — higher renders on top. */
  zIndex: number;
  locked: boolean;
  /** false = hidden from players (GM still sees a ghost). */
  visible: boolean;
  /** Optional owner (player tokens). */
  ownerId?: string;
}

export interface MapItem extends BaseItem {
  type: 'map';
  backgroundUrl: string | null;
  /** GLB/GLTF/STL terrain or scene mesh (shown in 3D view). */
  modelUrl?: string | null;
  gridSize: number;
  gridType: GridType;
  gridColor: number;   // PixiJS hex
  gridOpacity: number; // 0-1
  gridOffsetX: number;
  gridOffsetY: number;
  showGrid: boolean;
  /** LOS wall segments in map-local coordinates. */
  walls: WallSegment[];
}

export interface TokenItem extends BaseItem {
  type: 'token';
  /** 2D flat circle (Pixi) vs 3D cylinder miniature (Three.js). */
  renderType?: '2d' | '3d';
  /** Grid column / row on the active map (authoritative for move). */
  gridCol?: number;
  gridRow?: number;
  /** CSS hex border / rim colour. */
  borderColour?: string;
  name: string;
  imageUrl?: string;
  /** GLB/GLTF/STL mini (shown in 3D view; 2D shows a placeholder). */
  modelUrl?: string;
  /** Size in grid cells (0.5, 1, 2, 3, 4). width/height derive from this. */
  sizeCells: number;
  hp: number;
  maxHp: number;
  /** Temporary hit points (consumed before regular HP). */
  tempHp?: number;
  /** Armor Class (defaults to 10 when unset on legacy tokens). */
  ac?: number;
  conditions: string[];
  auraRadius?: number;  // in grid cells
  auraColor?: string;   // CSS hex
  /** Vision radius in grid cells (5ft per cell); UI uses feet. */
  visionRadius?: number;
  /** Vision cone width in degrees (default 90). 360 = omnidirectional. */
  visionArc?: number;
  /** Compendium link (MongoDB slug). */
  monsterId?: string;
  monsterCr?: string;
  monsterSource?: string;
  /** When true, players do not see this token's HP bar (GM always sees it). */
  hideHpFromPlayers?: boolean;
  /** Initiative modifier (typically DEX mod) for Roll Initiative. */
  initiativeMod?: number;
  /** Linked D&D Beyond character id. */
  ddbCharacterId?: number;
  /** Player character (vs monster/NPC). */
  isPc?: boolean;
  /** Push HP changes to D&D Beyond when linked. */
  syncHpToDdb?: boolean;
}

/** Compendium item card placed on the map (GM reveals to players). */
/** Decorative map image (drop wheel → Image) — not a combat token. */
export interface ImageItem extends BaseItem {
  type: 'image';
  name: string;
  imageUrl: string;
}

export interface HandoutItem extends BaseItem {
  type: 'handout';
  name: string;
  imageUrl?: string;
  /** Compendium slug (MongoDB id). */
  compendiumItemId: string;
  itemType?: string;
  rarity?: string;
  source?: string;
  /** Item description shown when players view the handout. */
  description: string;
}

export interface DrawItem extends BaseItem {
  type: 'drawing';
  shape: DrawShape;
  /** Local-space points relative to the item origin: [x0,y0,x1,y1,...]. */
  points: number[];
  color: string;        // CSS hex
  stroke: number;       // px
}

export interface TextItem extends BaseItem {
  type: 'text';
  text: string;
  color: string;        // CSS hex
  fontSize: number;
}

export type Item = MapItem | TokenItem | ImageItem | HandoutItem | DrawItem | TextItem;

// ─── Helpers ────────────────────────────────────────────────────────────────────

export const TOKEN_SIZE_LABELS: Record<string, string> = {
  '0.5': 'Tiny', '1': 'SM/MD', '2': 'Large', '3': 'Huge', '4': 'Garg.',
};

/** The center of an item in world space (ignoring rotation). */
export function itemCenter(item: BaseItem): { cx: number; cy: number } {
  return { cx: item.x + item.width / 2, cy: item.y + item.height / 2 };
}

export function isMap(i: Item): i is MapItem { return i.type === 'map'; }

/** Whether a player client should render this token's HP bar. */
export function tokenShowsHpBarToPlayer(token: TokenItem): boolean {
  return !isHpHiddenFromPlayers(token);
}

/** Effective HP bar visibility for players (undefined uses monster default). */
export function isHpHiddenFromPlayers(token: TokenItem): boolean {
  if (token.hideHpFromPlayers === true) return true;
  if (token.hideHpFromPlayers === false) return false;
  return Boolean(token.monsterId);
}
export function isToken(i: Item): i is TokenItem { return i.type === 'token'; }
export function isImage(i: Item): i is ImageItem { return i.type === 'image'; }
export function isHandout(i: Item): i is HandoutItem { return i.type === 'handout'; }
export function isDrawing(i: Item): i is DrawItem { return i.type === 'drawing'; }
export function isText(i: Item): i is TextItem { return i.type === 'text'; }
