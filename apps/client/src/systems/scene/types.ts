// ─── Unified Scene Item model ──────────────────────────────────────────────────
//
// Everything on the canvas (maps, tokens, drawings, text) is an `Item`.
// All items share the same transform (x/y/rotation/width/height), z-order,
// lock/visibility and ownership. Type-specific data lives on each subtype.

export type ItemType = 'map' | 'token' | 'image' | 'handout' | 'drawing' | 'text' | 'surfaceDecal';

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
  /**
   * Freehand FP breach shapes carved from walls (surface space).
   * Visual holes always; walk/LOS punches only where a cut opens near the floor.
   */
  wallCuts?: WallCut[];
  /** Last wall-breach FX cue (synced so all clients play debris once). */
  breachFx?: MapBreachFx | null;
  /** Generated dungeon floors. Clicking a stair opens the linked level. */
  dungeon?: DungeonFloorLink;
}

/**
 * Drawn breach on a wall face — only this shape is removed (not a rectangular section).
 * `points` are wall-surface [along, height, ...] from wallA toward wallB.
 */
export interface WallCut {
  id: string;
  wallA: WallPoint;
  wallB: WallPoint;
  points: number[];
  /** Brush half-width used to thicken an open stroke into a hole. */
  stroke: number;
  /** True when the stroke closed on itself — treat points as a fill polygon. */
  closed?: boolean;
}

/** Lightweight debris burst spawn point after a GM wall punch. */
export interface MapBreachFx {
  id: string;
  /** World-space center of the breach. */
  x: number;
  y: number;
  z: number;
  /** Outward wall normal on XZ (unit-ish). */
  nx: number;
  nz: number;
}

export interface DungeonStairRef {
  col: number;
  row: number;
  direction: 'up' | 'down';
  toMapId?: string;
}

export interface DungeonFloorLink {
  delveId: string;
  floor: number;
  baseName: string;
  cols: number;
  rows: number;
  cell: number;
  options: {
    layout: 'rooms' | 'cavern' | 'five-room' | 'hub' | 'gauntlet';
    size: 'tiny' | 'small' | 'medium' | 'large' | 'huge' | 'vast' | 'mega';
    doors: 'open' | 'closed' | 'mixed' | 'locked';
    seed: number;
    motif: 'mixed' | 'crypt' | 'temple' | 'fortress' | 'mine' | 'ruin';
    corridors: 'straight' | 'winding' | 'wide';
    passages: 'sparse' | 'linked' | 'maze';
    deadEnds: 'none' | 'few' | 'many';
    stairs: 'none' | 'down' | 'up' | 'both';
    key: 'brief' | 'full' | 'stocked';
    secrets: 'none' | 'few' | 'many';
    cavern: 'tight' | 'natural' | 'open';
    density?: 'sparse' | 'normal' | 'packed';
    furnishings?: 'none' | 'light' | 'full';
    chambers?: 'cramped' | 'normal' | 'grand';
  };
  stairs: DungeonStairRef[];
  /** Planned depth of this delve. The last floor has no stairs going deeper. */
  floorCount?: number;
  /** Room titles + notes (for prop spawn / GM key). */
  rooms?: Array<{
    id: number;
    x: number;
    y: number;
    w: number;
    h: number;
    title: string;
    notes: string[];
  }>;
  /** Auto prop pass from room notes (see DUNGEON_PROPS_SPAWN_REVISION). */
  propsSpawnRevision?: number;
  /** Auto door/gate pass from door map + notes (see DUNGEON_DOORS_SPAWN_REVISION). */
  doorsSpawnRevision?: number;
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
  /** Bumped when IndexedDB mesh is repaired/restored so Three reloads the GLB. */
  modelRevision?: number;
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
  /** Plain attack line from the NPC codex, rolled from the token actions panel. */
  attackText?: string;
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
  /** Dungeon prop id. Animated props draw on the map instead of the still image. */
  propId?: string;
  /** 0 rests. Toggles use 1 for open or sprung. Arrow traps count each shot. */
  propState?: number;
  /** Epoch ms when propState last changed, so every client plays the same motion. */
  propAt?: number;
  /**
   * When > 0 and the prop is hidden, revealing it to players requires a roll ≥ this DC
   * (search / Perception). Separate from opening.
   */
  propRevealDc?: number;
  /** Dice notation for the reveal check (default 1d20). */
  propRevealNotation?: string;
  /** Skill/ability for the reveal check (perception, investigation, …). */
  propRevealCheck?: string;
  /**
   * When > 0, activating this prop (open chest/door/gate, fire trap) requires a
   * dice roll ≥ this DC. Closing an already-open toggle skips the roll.
   */
  propActivateDc?: number;
  /** Dice notation for the activate check (default 1d20). Used when no check type / no character mod. */
  propActivateNotation?: string;
  /**
   * Linked skill or ability check id (perception, investigation, strength, …).
   * VTT rolls use the covering token’s DDB character modifier; DDB game-log rolls
   * can also satisfy an armed check.
   */
  propActivateCheck?: string;
  /** Set on props auto-placed from dungeon room notes for this map id. */
  dungeonPropForMapId?: string;
  /** Map-local top-left — prop moves and rotates with `dungeonPropForMapId`. */
  propMapLocalX?: number;
  propMapLocalY?: number;
  /** Rotation in degrees relative to the bound map (added to map.rotation for world pose). */
  propMapLocalRotation?: number;
  /** Override session door palette (see doorSurfaceStyles). */
  propDoorTheme?: string;
  /**
   * Floor = sit on ground (default). Wall = raised on nearest wall face
   * (torches, murals, racks) — use with propWallHeightCells.
   */
  propMount?: 'floor' | 'wall';
  /** Height above floor in grid cells when propMount is `wall` (default ~1.15). */
  propWallHeightCells?: number;
  /**
   * Sink into the mount surface: wall thickness when wall-mounted, or into the
   * floor when floor-mounted (flush / recessed instead of sitting proud).
   */
  propWallMerge?: boolean;
  /**
   * 3D tilt (degrees). Pitch tips top toward/away from camera yaw;
   * roll tips top sideways. Applied in Three.js on top of map `rotation` (yaw).
   */
  propPitch?: number;
  propRoll?: number;
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

/**
 * Permanent spray paint on a map floor or wall (FP tool).
 * Floor points: map-local [x,y,...]. Wall points: [along, height,...]
 * where along is distance from wallA toward wallB and height is world Y.
 */
export interface SurfaceDecalItem extends BaseItem {
  type: 'surfaceDecal';
  surface: 'floor' | 'wall';
  mapId: string;
  color: string;
  stroke: number;
  points: number[];
  /** Authored wall index at paint time (hint; prefer wallA/wallB). */
  wallIndex?: number;
  wallA?: WallPoint;
  wallB?: WallPoint;
}

export interface TextItem extends BaseItem {
  type: 'text';
  text: string;
  color: string;        // CSS hex
  fontSize: number;
}

export type Item = MapItem | TokenItem | ImageItem | HandoutItem | DrawItem | TextItem | SurfaceDecalItem;

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
export function isSurfaceDecal(i: Item): i is SurfaceDecalItem { return i.type === 'surfaceDecal'; }
export function isText(i: Item): i is TextItem { return i.type === 'text'; }
