import {
  getVisionTokens,
  isTokenVisibleToPlayer,
  playerHasVisionSource,
  playerVisibleCells,
} from '@/systems/map/fogLos';
import { useMapStore } from '@/systems/map/store/mapStore';
import { getActiveMap, useItemStore } from '@/systems/scene/store/itemStore';
import { useSessionStore } from '@/store/sessionStore';
import { isFogOverlayVisible } from '@/systems/scene/fogActiveSync';
import type { Item, MapItem, TokenItem } from '../types';

/** Tokens hidden by fog of war — interaction and rendering. */
export function filterPlayerTokens(
  items: Record<string, Item>,
  opts: {
    myUserId: string | null;
    selectedIds: string[];
    revealedCells: Set<string>;
    activeMap: MapItem | null;
  },
): TokenItem[] {
  const tokens = Object.values(items).filter(
    (i): i is TokenItem => i.type === 'token' && i.visible !== false,
  );

  if (!isFogOverlayVisible() || !opts.activeMap) {
    return tokens;
  }

  const map = opts.activeMap;

  // No assigned or selected vision source — hide every token under fog.
  if (!playerHasVisionSource(items, opts.myUserId, opts.selectedIds, map)) {
    return [];
  }

  const visionTokens = getVisionTokens(
    items,
    opts.selectedIds,
    false,
    opts.myUserId,
    map,
  );
  const visionIds = new Set(visionTokens.map((t) => t.id));
  const seenCells = playerVisibleCells(
    opts.revealedCells,
    map,
    items,
    opts.myUserId,
    opts.selectedIds,
    map.gridSize,
  );

  return tokens.filter((t) => {
    if (visionIds.has(t.id)) return true;
    return isTokenVisibleToPlayer(t, map, seenCells);
  });
}

export function playerOwnsToken(token: TokenItem, myUserId: string | null): boolean {
  const uid = myUserId?.trim() ?? '';
  return Boolean(uid) && token.ownerId?.trim() === uid;
}

/** PC / player character — includes DDB imports without explicit isPc. */
export function isPlayerCharacterToken(token: TokenItem): boolean {
  return Boolean(token.isPc || token.ddbCharacterId);
}

/** True when a client may drag this token (same rules for GM and players). */
export function playerCanMoveToken(
  token: TokenItem,
  _myUserId: string | null = null,
  _selectedIds: readonly string[] = [],
): boolean {
  if (token.locked) return false;
  return token.visible !== false;
}

/** True when a player may rotate this token (GM may rotate everything). */
export function playerCanRotateToken(token: TokenItem, myUserId: string | null): boolean {
  if (token.locked) return false;
  if (token.visible === false) return false;
  // Prefer explicit ownership, but allow PC tokens without ownerId (common with DDB imports).
  return playerOwnsToken(token, myUserId) || isPlayerCharacterToken(token);
}

/** Tokens a player may click/drag under fog — same set as rendering. */
export function playerSelectableTokens(
  items: Record<string, Item>,
  opts: {
    myUserId: string | null;
    selectedIds: string[];
    revealedCells: Set<string>;
    activeMap: MapItem | null;
  },
): TokenItem[] {
  const allVisible = Object.values(items).filter(
    (i): i is TokenItem => i.type === 'token' && i.visible !== false,
  );

  if (!isFogOverlayVisible() || !opts.activeMap) {
    return allVisible;
  }

  return filterPlayerTokens(items, opts);
}

/** All visible unlocked tokens — used for player drag / hit-testing. */
export function playerInteractableTokens(items: Record<string, Item>): TokenItem[] {
  const unlocked = Object.values(items).filter(
    (i): i is TokenItem => i.type === 'token' && i.visible !== false && !i.locked,
  );
  if (!isFogOverlayVisible()) return unlocked;

  const { myUserId } = useSessionStore.getState();
  const { selectedIds } = useItemStore.getState();
  const revealedCells = useMapStore.getState().revealedCells;
  const activeMap = getActiveMap();
  return filterPlayerTokens(items, {
    myUserId,
    selectedIds,
    revealedCells,
    activeMap,
  }).filter((t) => !t.locked);
}
