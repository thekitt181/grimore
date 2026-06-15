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
    const selectedSet = new Set(opts.selectedIds);
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

/** Player tokens for selection/rendering — always includes owned tokens. */
export function playerSelectableTokens(
  items: Record<string, Item>,
  opts: {
    myUserId: string | null;
    selectedIds: string[];
    revealedCells: Set<string>;
    activeMap: MapItem | null;
  },
): TokenItem[] {
  const filtered = filterPlayerTokens(items, opts);
  const uid = opts.myUserId?.trim() ?? '';
  if (!uid) return filtered;

  const seen = new Set(filtered.map((t) => t.id));
  for (const i of Object.values(items)) {
    if (i.type !== 'token' || i.visible === false) continue;
    if (i.ownerId?.trim() !== uid || seen.has(i.id)) continue;
    seen.add(i.id);
    filtered.push(i);
  }
  return filtered;
}
