import {
  isTokenVisibleToPlayer,
  playerHasVisionSource,
  playerSeenCellKeys,
} from '@/systems/map/fogLos';
import { isFogOverlayVisible } from '@/systems/scene/fogActiveSync';
import type { Item, MapItem, TokenItem } from '../types';

/** Tokens a player may see / interact with while fog is active. */
export function filterPlayerTokens(
  items: Record<string, Item>,
  opts: {
    myUserId: string | null;
    selectedIds: string[];
    revealedCells: Set<string>;
    activeMap: MapItem | null;
  },
): TokenItem[] {
  const uid = opts.myUserId?.trim() ?? '';
  const tokens = Object.values(items).filter(
    (i): i is TokenItem => i.type === 'token' && i.visible !== false,
  );

  if (!isFogOverlayVisible() || !opts.activeMap) {
    return tokens;
  }

  const map = opts.activeMap;
  const own = tokens.filter((t) => t.ownerId?.trim() === uid);

  if (!playerHasVisionSource(items, opts.myUserId, opts.selectedIds, map)) {
    const dedupe = (list: TokenItem[]) => {
      const seen = new Set<string>();
      return list.filter((t) => {
        if (seen.has(t.id)) return false;
        seen.add(t.id);
        return true;
      });
    };

    if (opts.revealedCells.size > 0) {
      const inReveal = tokens.filter((t) =>
        isTokenVisibleToPlayer(t, map, opts.revealedCells),
      );
      return dedupe([...own, ...inReveal]);
    }

    const selectedSet = new Set(opts.selectedIds);
    const selectedPc = tokens.filter((t) => {
      if (!selectedSet.has(t.id)) return false;
      if (!isPlayerCharacterToken(t)) return false;
      const owner = t.ownerId?.trim() ?? '';
      return !owner || owner === uid;
    });
    if (selectedPc.length > 0) {
      const seen = new Set<string>();
      return [...own, ...selectedPc].filter((t) => {
        if (seen.has(t.id)) return false;
        seen.add(t.id);
        return true;
      });
    }
    const selectedOwn = own.filter((t) => selectedSet.has(t.id));
    return selectedOwn.length > 0 ? selectedOwn : own;
  }

  const seen = playerSeenCellKeys(
    opts.revealedCells,
    map,
    items,
    opts.myUserId,
    opts.selectedIds,
    map.gridSize,
  );

  const visibleOthers = tokens.filter((t) => {
    if (t.ownerId?.trim() === uid) return false;
    return isTokenVisibleToPlayer(t, map, seen);
  });

  return [...own, ...visibleOthers];
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

/** Player tokens for rendering / fog visibility (not necessarily all interactable). */
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
  return Object.values(items).filter(
    (i): i is TokenItem => i.type === 'token' && i.visible !== false && !i.locked,
  );
}
