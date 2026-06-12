import type { SessionUser } from './user';
import type { DdbCharacterSyncPayload, DdbHpUpdatePayload, DdbRollBridgePayload } from './ddb';
import type { CatalogRebuildProgress } from './compendium';

// ─── Map events ───────────────────────────────────────────────────────────────

export interface FogUpdatePayload {
  sessionId: string;
  /** Full snapshot — used on join / GM flush. */
  fogData?: string;
  /** Incremental reveal (smaller than full snapshot during play). */
  added?: string[];
  /** Incremental hide. */
  removed?: string[];
}

/** Full fog state pushed to joining clients or on GM sync. */
export interface FogSyncPayload {
  sessionId: string;
  fogData: string;
}

/** GM toggles whether fog-of-war is active for the whole session. */
export interface FogActivePayload {
  sessionId: string;
  active: boolean;
}

export interface GridUpdatePayload {
  sessionId: string;
  gridSize: number;
  gridType: 'square' | 'hex';
}

export interface MapMovePayload {
  sessionId: string;
  mapId: string;
  canvasX: number;
  canvasY: number;
}

export interface MapResizePayload {
  sessionId: string;
  mapId: string;
  width: number;
  height: number;
  canvasX: number;
  canvasY: number;
  newGridSize?: number;
}

export interface MapLockPayload {
  sessionId: string;
  mapId: string;
  locked: boolean;
}

export interface MapHidePayload {
  sessionId: string;
  mapId: string;
  hidden: boolean;
}

export interface MapDeletePayload {
  sessionId: string;
  mapId: string;
}

export interface MapGridStylePayload {
  sessionId: string;
  mapId: string;
  gridColor: number;
  gridOpacity: number;
}

export interface MapGridOffsetPayload {
  sessionId: string;
  mapId: string;
  offsetX: number;
  offsetY: number;
}

// ─── Generic scene-item events (unified editor) ─────────────────────────────────

export interface ItemAddPayload {
  sessionId: string;
  item: unknown; // client-side Item shape
}

export interface ItemUpdatePayload {
  sessionId: string;
  patches: Array<{ id: string; patch: Record<string, unknown> }>;
}

export interface ItemRemovePayload {
  sessionId: string;
  ids: string[];
}

export interface ItemsSyncPayload {
  sessionId: string;
  items: unknown[];
}

// ─── Token events (PROJECT.md) ────────────────────────────────────────────────

export interface TokenPlacePayload {
  sessionId: string;
  token: Record<string, unknown>;
}

export interface TokenMovePayload {
  sessionId: string;
  tokenId: string;
  gridCol: number;
  gridRow: number;
  x: number;
  y: number;
}

export interface TokenHpPayload {
  sessionId: string;
  tokenId: string;
  hp: number;
  maxHp: number;
}

export interface TokenTypePayload {
  sessionId: string;
  tokenId: string;
  type: '2d' | '3d';
}

export interface TokenRotatePayload {
  sessionId: string;
  tokenId: string;
  rotation: number;
}

export interface TokenHidePayload {
  sessionId: string;
  tokenId: string;
  hidden: boolean;
}

export interface TokenDeletePayload {
  sessionId: string;
  tokenId: string;
}

export interface TokenConditionPayload {
  sessionId: string;
  tokenId: string;
  conditions: string[];
}

// ─── Drawing events ───────────────────────────────────────────────────────────

export interface DrawingAddPayload {
  sessionId: string;
  drawing: {
    id: string;
    type: string;
    points: number[];
    color: string;
    stroke: number;
    text?: string;
    userId: string;
  };
}

export interface DrawingRemovePayload {
  sessionId: string;
  drawingId: string;
}

export interface DrawingClearPayload {
  sessionId: string;
}

// ─── Token extra events ───────────────────────────────────────────────────────

export interface TokenConditionsPayload {
  sessionId: string;
  tokenId: string;
  conditions: string[];
}

export interface TokenAuraPayload {
  sessionId: string;
  tokenId: string;
  auraRadius?: number;
  auraColor?: string;
}

// ─── Initiative extended sync ─────────────────────────────────────────────────

export interface InitiativeSyncPayload {
  sessionId: string;
  combatants: Array<{
    id: string;
    name: string;
    initiative: number;
    hp: number;
    maxHp: number;
    tempHp: number;
    conditions: string[];
    tokenId?: string;
    isPlayer: boolean;
  }>;
  currentIndex: number;
  round: number;
  isActive: boolean;
}

// ─── Combat events ────────────────────────────────────────────────────────────

export interface InitiativePayload {
  sessionId: string;
  order: Array<{ tokenId: string; initiative: number; name: string }>;
  round: number;
  currentTurnIndex: number;
}

export interface HpUpdatePayload {
  sessionId: string;
  tokenId: string;
  currentHp: number;
  maxHp: number;
  tempHp: number;
}

// ─── Dice events ──────────────────────────────────────────────────────────────

export type DiceRollMode = 'normal' | 'advantage' | 'disadvantage';

export interface DiceRollPayload {
  sessionId: string;
  rollerId: string;
  rollerName: string;
  notation: string;
  results: number[];
  /** Values that counted toward total (advantage/disadvantage). */
  usedResults?: number[];
  /** Discarded d20 faces for advantage/disadvantage. */
  droppedResults?: number[];
  total: number;
  isSecret: boolean;
  /** Non-GMs receive this instead of numeric results for GM secret rolls. */
  secretHidden?: boolean;
  isCrit: boolean;
  isCritFail: boolean;
  rollMode?: DiceRollMode;
  timestamp: number;
}

// ─── Scene events ─────────────────────────────────────────────────────────────

export interface SceneChangePayload {
  sessionId: string;
  sceneId: string;
  transition: 'fade' | 'fire' | 'page-turn' | 'none';
}

// ─── Handout events ───────────────────────────────────────────────────────────

export interface HandoutRevealPayload {
  sessionId: string;
  handoutId: string;
  title: string;
  content: string;
  imageUrl?: string;
  targetUserIds: string[] | 'all';
}

// ─── Chat events ──────────────────────────────────────────────────────────────

export type ChatMessageType = 'text' | 'roll' | 'whisper' | 'system';

export interface ChatMessagePayload {
  sessionId: string;
  id: string;
  type: ChatMessageType;
  senderId: string;
  senderName: string;
  content: string;
  roll?: DiceRollPayload;
  whisperToId?: string;
  timestamp: number;
}

// ─── Session lifecycle ────────────────────────────────────────────────────────

export interface UserJoinedPayload {
  sessionId: string;
  user: SessionUser;
}

export interface UserLeftPayload {
  sessionId: string;
  userId: string;
}

// ─── Typed socket event map ───────────────────────────────────────────────────

export interface CompendiumUpdatedPayload {
  lastUpdated: string;
}

export type CompendiumCatalogRebuildPayload = CatalogRebuildProgress;

// ─── D&D Beyond events ────────────────────────────────────────────────────────

export type { DdbRollBridgePayload, DdbCharacterSyncPayload, DdbHpUpdatePayload };

export interface ServerToClientEvents {
  'item:add':             (payload: ItemAddPayload)           => void;
  'item:update':          (payload: ItemUpdatePayload)        => void;
  'item:remove':          (payload: ItemRemovePayload)        => void;
  'items:sync':           (payload: ItemsSyncPayload)         => void;
  'token:place':          (payload: TokenPlacePayload)         => void;
  'token:move':           (payload: TokenMovePayload)          => void;
  'token:hp':             (payload: TokenHpPayload)            => void;
  'token:type':           (payload: TokenTypePayload)          => void;
  'token:rotate':         (payload: TokenRotatePayload)        => void;
  'token:hide':           (payload: TokenHidePayload)          => void;
  'token:delete':         (payload: TokenDeletePayload)        => void;
  'token:condition':      (payload: TokenConditionPayload)     => void;
  'map:tokenMove':        (payload: TokenMovePayload)         => void;
  'map:fogUpdate':        (payload: FogUpdatePayload)         => void;
  'fog:sync':             (payload: FogSyncPayload)          => void;
  'fog:active':           (payload: FogActivePayload)         => void;
  'map:gridUpdate':       (payload: GridUpdatePayload)        => void;
  'map:mapMove':          (payload: MapMovePayload)           => void;
  'map:mapResize':        (payload: MapResizePayload)         => void;
  'map:mapLock':          (payload: MapLockPayload)           => void;
  'map:mapHide':          (payload: MapHidePayload)           => void;
  'map:mapDelete':        (payload: MapDeletePayload)         => void;
  'map:gridStyle':        (payload: MapGridStylePayload)      => void;
  'map:gridOffset':       (payload: MapGridOffsetPayload)     => void;
  'map:tokenConditions':  (payload: TokenConditionsPayload)   => void;
  'map:tokenAura':        (payload: TokenAuraPayload)         => void;
  'drawing:add':          (payload: DrawingAddPayload)        => void;
  'drawing:remove':       (payload: DrawingRemovePayload)     => void;
  'drawing:clear':        (payload: DrawingClearPayload)      => void;
  'initiative:sync':      (payload: InitiativeSyncPayload)    => void;
  'combat:initiative':    (payload: InitiativePayload)        => void;
  'combat:hpUpdate':      (payload: HpUpdatePayload)          => void;
  'dice:roll':            (payload: DiceRollPayload)          => void;
  'scene:change':         (payload: SceneChangePayload)       => void;
  'handout:reveal':       (payload: HandoutRevealPayload)     => void;
  'chat:message':         (payload: ChatMessagePayload)       => void;
  'session:userJoined':   (payload: UserJoinedPayload)        => void;
  'session:userLeft':     (payload: UserLeftPayload)          => void;
  'session:roomState':    (payload: { users: SessionUser[]; fogActive?: boolean }) => void;
  'compendium:updated':   (payload: CompendiumUpdatedPayload) => void;
  'compendium:catalog-rebuild': (payload: CompendiumCatalogRebuildPayload) => void;
  'ddb:roll':             (payload: DdbRollBridgePayload) => void;
  'ddb:rollBridge:status': (payload: {
    sessionId: string;
    connected: boolean;
    ddbCampaignId?: number;
    error?: string;
  }) => void;
  'ddb:characterSync':    (payload: DdbCharacterSyncPayload) => void;
  'character:hpUpdate':   (payload: DdbHpUpdatePayload) => void;
  error: (payload: { message: string }) => void;
}

export interface ClientToServerEvents {
  'session:join':         (payload: { sessionId: string; campaignId: string }) => void;
  'session:leave':        (payload: { sessionId: string }) => void;
  'item:add':             (payload: ItemAddPayload)           => void;
  'item:update':          (payload: ItemUpdatePayload)        => void;
  'item:remove':          (payload: ItemRemovePayload)        => void;
  'items:sync':           (payload: ItemsSyncPayload)         => void;
  'token:place':          (payload: TokenPlacePayload)         => void;
  'token:move':           (payload: TokenMovePayload)          => void;
  'token:hp':             (payload: TokenHpPayload)            => void;
  'token:type':           (payload: TokenTypePayload)          => void;
  'token:rotate':         (payload: TokenRotatePayload)        => void;
  'token:hide':           (payload: TokenHidePayload)          => void;
  'token:delete':         (payload: TokenDeletePayload)        => void;
  'token:condition':      (payload: TokenConditionPayload)     => void;
  'map:tokenMove':        (payload: TokenMovePayload)         => void;
  'map:fogUpdate':        (payload: FogUpdatePayload)         => void;
  'fog:sync':             (payload: FogSyncPayload)          => void;
  'fog:active':           (payload: FogActivePayload)         => void;
  'map:gridUpdate':       (payload: GridUpdatePayload)        => void;
  'map:mapMove':          (payload: MapMovePayload)           => void;
  'map:mapResize':        (payload: MapResizePayload)         => void;
  'map:mapLock':          (payload: MapLockPayload)           => void;
  'map:mapHide':          (payload: MapHidePayload)           => void;
  'map:mapDelete':        (payload: MapDeletePayload)         => void;
  'map:gridStyle':        (payload: MapGridStylePayload)      => void;
  'map:gridOffset':       (payload: MapGridOffsetPayload)     => void;
  'map:tokenConditions':  (payload: TokenConditionsPayload)   => void;
  'map:tokenAura':        (payload: TokenAuraPayload)         => void;
  'drawing:add':          (payload: DrawingAddPayload)        => void;
  'drawing:remove':       (payload: DrawingRemovePayload)     => void;
  'drawing:clear':        (payload: DrawingClearPayload)      => void;
  'initiative:sync':      (payload: InitiativeSyncPayload)    => void;
  'combat:initiative':    (payload: InitiativePayload)        => void;
  'combat:hpUpdate':      (payload: HpUpdatePayload)          => void;
  'dice:roll':            (payload: DiceRollPayload)          => void;
  'scene:change':         (payload: SceneChangePayload)       => void;
  'handout:reveal':       (payload: HandoutRevealPayload)     => void;
  'chat:message':         (payload: ChatMessagePayload)       => void;
  'ddb:rollBridge:start': (payload: { sessionId: string; ddbCampaignId?: number }) => void;
  'ddb:rollBridge:stop':  (payload: { sessionId: string }) => void;
}
