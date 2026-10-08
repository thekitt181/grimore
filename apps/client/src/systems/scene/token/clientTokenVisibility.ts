import {
  getVisionTokens,
  isTokenVisibleToPlayer,
  playerHasVisionSource,
  playerVisibleCells,
  tokenOnMap,
} from '@/systems/map/fogLos';
import { useMapStore } from '@/systems/map/store/mapStore';
import { getActiveMap, useItemStore } from '@/systems/scene/store/itemStore';
import { useSessionStore } from '@/store/sessionStore';
import { isFogOverlayVisible } from '@/systems/scene/fogActiveSync';
import type { Item, MapItem, TokenItem } from '../types';

/** The player's own token stays on the table under fog so they can still drag it. */
function tokensPlayerKeeps(
  tokens: TokenItem[],
  userId: string | null,
  selectedIds: string[],
): TokenItem[] {
  const selected = new Set(selectedIds);
  const uid = userId?.trim() ?? '';
  const kept = new Map<string, TokenItem>();
  for (const token of tokens) {
    const owner = token.ownerId?.trim() ?? '';
    const mine = (uid !== '' && owner === uid)
      || selected.has(token.id)
      || (owner === '' && (isPlayerCharacterToken(token) || !token.monsterId));
    if (mine) kept.set(token.id, token);
  }
  return [...kept.values()];
}

function mapUnderToken(token: TokenItem, items: Record<string, Item>): MapItem | null {
  for (const item of Object.values(items)) {
    if (item.type === 'map' && tokenOnMap(token, item)) return item;
  }
  return null;
}

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

  if (!isFogOverlayVisible()) return tokens;

  const keep = tokensPlayerKeeps(tokens, opts.myUserId, opts.selectedIds);
  const map = (keep[0] && mapUnderToken(keep[0], items)) || opts.activeMap;
  if (!map) return keep.length > 0 ? keep : tokens;

  const visionTokens = getVisionTokens(
    items,
    opts.selectedIds,
    false,
    opts.myUserId,
    map,
  );
  const visibleIds = new Set<string>([
    ...keep.map((token) => token.id),
    ...visionTokens.map((token) => token.id),
  ]);
  if (visibleIds.size === 0 && !playerHasVisionSource(items, opts.myUserId, opts.selectedIds, map)) {
    return keep;
  }

  const seenCells = playerVisibleCells(
    opts.revealedCells,
    map,
    items,
    opts.myUserId,
    opts.selectedIds,
    map.gridSize,
  );

  return tokens.filter((token) => {
    if (visibleIds.has(token.id)) return true;
    return isTokenVisibleToPlayer(token, map, seenCells);
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
