import { useEffect, useRef } from 'react';
import { Container } from 'pixi.js';
import { useItemStore, getActiveMap } from '../store/itemStore';
import { useSessionStore } from '@/store/sessionStore';
import { useInitiativeStore } from '@/systems/map/store/initiativeStore';
import { useMapStore } from '@/systems/map/store/mapStore';
import { isFogOverlayVisible } from '@/systems/scene/fogActiveSync';
import {
  isTokenVisibleToPlayer,
  playerHasVisionSource,
  playerSeenCellKeys,
} from '@/systems/map/fogLos';
import {
  itemsWithLiveTransforms,
  useLiveTransformStore,
} from '../store/liveTransformStore';
import { renderItem, itemVisualSignature, tokenOverlayVisualSignature, updateTokenOverlay, renderMapWalls, wallVisualSignature, type RenderContext } from './renderers';
import type { Item, MapItem, TokenItem } from '../types';
import { itemDisplayZIndex, wallDisplayZIndex } from '../zOrder';

/**
 * Renders all scene items into a single sortable PixiJS layer.
 * One Container per item, keyed by id. Transform (position/rotation/z) is applied
 * every pass; children are only rebuilt when the item's visual signature changes.
 *
 * Selection/move/transform are handled by the DOM-based interaction hooks, so
 * item containers are NON-interactive (eventMode 'none') to avoid clashing with
 * pan/zoom — this is what kept token/pan behaviour stable previously.
 */
export function useItemRenderer(
  layerRef: React.RefObject<Container | null>,
  appReady: boolean,
) {
  const items   = useItemStore((s) => s.items);
  const selectedIds = useItemStore((s) => s.selectedIds);
  const selectedWallIndices = useItemStore((s) => s.selectedWallIndices);
  const myRole  = useSessionStore((s) => s.myRole);
  const myUserId = useSessionStore((s) => s.myUserId);
  const revealedCells = useMapStore((s) => s.revealedCells);
  const revealedCount = useMapStore((s) => s.revealedCells.size);
  const fogEnabled = useMapStore((s) => s.fogEnabled);
  const sessionFogActive = useMapStore((s) => s.sessionFogActive);
  const liveById = useLiveTransformStore((s) => s.byId);
  const liveTick = useLiveTransformStore((s) => s.tick);
  const activeTurnItemId = useInitiativeStore((s) =>
    s.isActive && s.combatants[s.currentIndex] ? s.combatants[s.currentIndex]!.tokenId : undefined
  );
  const viewMode = useMapStore((s) => s.viewMode);

  const containers = useRef<Map<string, Container>>(new Map());
  const wallContainers = useRef<Map<string, Container>>(new Map());
  const signatures = useRef<Map<string, string>>(new Map());
  const overlaySignatures = useRef<Map<string, string>>(new Map());
  const wallSignatures = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    if (!appReady) {
      for (const c of containers.current.values()) c.destroy({ children: true });
      for (const c of wallContainers.current.values()) c.destroy({ children: true });
      containers.current.clear();
      wallContainers.current.clear();
      signatures.current.clear();
      overlaySignatures.current.clear();
      wallSignatures.current.clear();
      return;
    }

    const layer = layerRef.current;
    if (!layer) return;

    layer.sortableChildren = true;
    const gm: boolean = myRole === 'GM';
    const ctx: RenderContext = {
      gm,
      viewMode,
      ...(activeTurnItemId ? { activeTurnItemId } : {}),
    };
    const itemsForVision = itemsWithLiveTransforms(items, liveById);
    const activeMap = getActiveMap();
    const fogFiltersTokens = !gm && isFogOverlayVisible();
    const hasVision = Boolean(
      fogFiltersTokens
      && activeMap
      && playerHasVisionSource(itemsForVision, myUserId, selectedIds, activeMap),
    );
    const seenCells = hasVision && activeMap
      ? playerSeenCellKeys(
        revealedCells,
        activeMap,
        itemsForVision,
        myUserId,
        selectedIds,
        activeMap.gridSize,
      )
      : null;

    const liveIds = new Set(Object.keys(items));
    const liveMapIds = new Set(
      Object.values(items).filter((i): i is MapItem => i.type === 'map').map((m) => m.id),
    );

    // Remove containers for deleted items
    for (const [id, c] of containers.current) {
      if (!liveIds.has(id)) {
        c.destroy({ children: true });
        containers.current.delete(id);
        signatures.current.delete(id);
        overlaySignatures.current.delete(id);
      }
    }
    for (const [mapId, wc] of wallContainers.current) {
      if (!liveMapIds.has(mapId)) {
        wc.destroy({ children: true });
        wallContainers.current.delete(mapId);
        wallSignatures.current.delete(mapId);
      }
    }

    for (const item of Object.values(items) as Item[]) {
      let c = containers.current.get(item.id);
      if (!c || c.parent !== layer) {
        c = new Container();
        c.label = `item_${item.id}`;
        c.eventMode = 'none';
        layer.addChild(c);
        containers.current.set(item.id, c);
      }

      // Rebuild children only when visual data changed; tokens patch overlay separately.
      const sig = itemVisualSignature(item, ctx);
      const prevSig = signatures.current.get(item.id);
      if (prevSig !== sig) {
        renderItem(c, item, ctx);
        signatures.current.set(item.id, sig);
        if (item.type === 'token') {
          overlaySignatures.current.set(item.id, tokenOverlayVisualSignature(item, ctx));
        }
      } else if (item.type === 'token') {
        const overlaySig = tokenOverlayVisualSignature(item, ctx);
        if (overlaySignatures.current.get(item.id) !== overlaySig) {
          updateTokenOverlay(c, item, ctx);
          overlaySignatures.current.set(item.id, overlaySig);
        }
      }

      // Transform — merge live drag offsets so tokens stay aligned with fog vision.
      const live = liveById[item.id];
      const drawX = live?.x ?? item.x;
      const drawY = live?.y ?? item.y;
      const drawRot = live?.rotation ?? item.rotation;
      c.scale.set(1, 1);
      c.pivot.set(item.width / 2, item.height / 2);
      c.position.set(drawX + item.width / 2, drawY + item.height / 2);
      c.rotation = (drawRot * Math.PI) / 180;
      c.zIndex = itemDisplayZIndex(item);

      // Visibility / ghosting
      let show = item.visible || gm;
      let alpha = item.visible || !gm ? 1 : 0.35;

      if (show && item.type === 'token' && fogFiltersTokens) {
        const visionToken = (itemsForVision[item.id] ?? item) as TokenItem;
        if (!activeMap || !seenCells || !isTokenVisibleToPlayer(visionToken, activeMap, seenCells)) {
          show = false;
        }
      }

      c.visible = show;
      c.alpha = show ? alpha : 1;

      // Wall overlay — always above map background/grid, below tokens
      if (item.type === 'map') {
        const map = item as MapItem;
        let wc = wallContainers.current.get(map.id);
        if (!wc || wc.parent !== layer) {
          wc = new Container();
          wc.label = `walls_${map.id}`;
          wc.eventMode = 'none';
          layer.addChild(wc);
          wallContainers.current.set(map.id, wc);
        }
        const isActiveMap = activeMap?.id === map.id;
        const wallSel = isActiveMap ? selectedWallIndices : [];
        const wallSig = wallVisualSignature(map.id, map.walls ?? [], wallSel);
        if (wallSignatures.current.get(map.id) !== wallSig) {
          renderMapWalls(wc, map.walls ?? [], new Set(wallSel));
          wallSignatures.current.set(map.id, wallSig);
        }
        wc.scale.set(1, 1);
        wc.pivot.set(map.width / 2, map.height / 2);
        wc.position.set(map.x + map.width / 2, map.y + map.height / 2);
        wc.rotation = (map.rotation * Math.PI) / 180;
        wc.zIndex = wallDisplayZIndex(map.zIndex);
        // LOS walls affect everyone; only the GM sees the wall overlay.
        if (gm) {
          wc.visible = true;
          wc.alpha = map.visible ? 1 : 0.35;
        } else {
          wc.visible = false;
        }
      }
    }
  }, [
    items,
    selectedIds,
    selectedWallIndices,
    myRole,
    myUserId,
    revealedCells,
    revealedCount,
    fogEnabled,
    sessionFogActive,
    liveById,
    liveTick,
    activeTurnItemId,
    viewMode,
    appReady,
  ]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      for (const c of containers.current.values()) c.destroy({ children: true });
      for (const c of wallContainers.current.values()) c.destroy({ children: true });
      containers.current.clear();
      wallContainers.current.clear();
      signatures.current.clear();
      overlaySignatures.current.clear();
      wallSignatures.current.clear();
    };
  }, []);
}

/** Returns the live PixiJS container for an item (used by interaction hooks). */
export function getItemContainer(layer: Container | null, id: string): Container | null {
  if (!layer) return null;
  return (layer.getChildByLabel(`item_${id}`) as Container) ?? null;
}
