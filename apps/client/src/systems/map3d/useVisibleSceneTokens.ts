import { useMemo } from 'react';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { useInitiativeStore } from '@/systems/map/store/initiativeStore';
import { useMapStore } from '@/systems/map/store/mapStore';
import {
  itemsWithLiveTransforms,
  useLiveTransformStore,
} from '@/systems/scene/store/liveTransformStore';
import { sceneTokensForClient } from '@/systems/scene/sceneMapsForClient';
import { getActiveTimeOfDay, useSceneMediaStore } from '@/systems/scene/media/sceneMediaStore';
import { useSessionStore } from '@/store/sessionStore';
import type { TokenItem } from '@/systems/scene/types';

/** Tokens rendered in Three.js — same set for GM and players (hidden tokens are GM-only). */
export function useVisibleSceneTokens(opts?: { modelOnly?: boolean }): {
  tokens: TokenItem[];
  activeTurnItemId?: string;
} {
  const items = useItemStore((s) => s.items);
  const liveTick = useLiveTransformStore((s) => s.tick);
  const gm = useSessionStore((s) => s.myRole === 'GM');
  const selectedIds = useItemStore((s) => s.selectedIds);
  const myUserId = useSessionStore((s) => s.myUserId);
  const fogRevision = useMapStore((s) => s.fogRevision);
  // Midnight auto-fog changes LOS without bumping fogRevision.
  const timeOfDay = useSceneMediaStore(() => getActiveTimeOfDay());
  const activeTurnItemId = useInitiativeStore((s) =>
    s.isActive && s.combatants[s.currentIndex] ? s.combatants[s.currentIndex]!.tokenId : undefined,
  );

  const tokens = useMemo(() => {
    const merged = itemsWithLiveTransforms(items, useLiveTransformStore.getState().byId);
    const visible = sceneTokensForClient(Object.values(merged), gm);
    if (!opts?.modelOnly) return visible;
    return visible.filter((t) => Boolean(t.modelUrl));
  }, [items, liveTick, gm, fogRevision, timeOfDay, selectedIds, myUserId, opts?.modelOnly]);

  return {
    tokens,
    ...(activeTurnItemId ? { activeTurnItemId } : {}),
  };
}
