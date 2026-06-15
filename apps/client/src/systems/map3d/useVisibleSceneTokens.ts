import { useMemo } from 'react';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { useMapStore } from '@/systems/map/store/mapStore';
import { useSessionStore } from '@/store/sessionStore';
import { useInitiativeStore } from '@/systems/map/store/initiativeStore';
import {
  itemsWithLiveTransforms,
  useLiveTransformStore,
} from '@/systems/scene/store/liveTransformStore';
import { playerSelectableTokens } from '@/systems/scene/token/clientTokenVisibility';
import type { MapItem, TokenItem } from '@/systems/scene/types';
import { getActiveMap } from '@/systems/scene/store/itemStore';

export function useVisibleSceneTokens(opts?: { modelOnly?: boolean }): {
  tokens: TokenItem[];
  activeTurnItemId?: string;
} {
  const items = useItemStore((s) => s.items);
  const selectedIds = useItemStore((s) => s.selectedIds);
  const activeMapId = useItemStore((s) => s.activeMapId);
  const liveById = useLiveTransformStore((s) => s.byId);
  const liveTick = useLiveTransformStore((s) => s.tick);
  const myRole = useSessionStore((s) => s.myRole);
  const myUserId = useSessionStore((s) => s.myUserId);
  const revealedCells = useMapStore((s) => s.revealedCells);
  const fogRevision = useMapStore((s) => s.fogRevision);
  const fogEnabled = useMapStore((s) => s.fogEnabled);
  const sessionFogActive = useMapStore((s) => s.sessionFogActive);
  const activeTurnItemId = useInitiativeStore((s) =>
    s.isActive && s.combatants[s.currentIndex] ? s.combatants[s.currentIndex]!.tokenId : undefined,
  );

  const tokens = useMemo(() => {
    void liveTick;
    const gm = myRole === 'GM';
    const merged = itemsWithLiveTransforms(items, liveById);
    const activeMap = getActiveMap() as MapItem | null;

    const allTokens = Object.values(merged).filter((i): i is TokenItem => {
      if (i.type !== 'token') return false;
      if (opts?.modelOnly && !i.modelUrl) return false;
      if (gm) return true;
      return i.visible !== false;
    });

    if (gm) return allTokens;

    return playerSelectableTokens(merged, {
      myUserId,
      selectedIds,
      revealedCells,
      activeMap,
    }).filter((t) => !opts?.modelOnly || Boolean(t.modelUrl));
  }, [
    items,
    selectedIds,
    activeMapId,
    liveById,
    liveTick,
    myRole,
    myUserId,
    revealedCells,
    fogRevision,
    fogEnabled,
    sessionFogActive,
    opts?.modelOnly,
  ]);

  return {
    tokens,
    ...(activeTurnItemId ? { activeTurnItemId } : {}),
  };
}
