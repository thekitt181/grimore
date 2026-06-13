import { useEffect, useRef } from 'react';
import { Container } from 'pixi.js';
import { useItemStore, getActiveMap } from '../store/itemStore';
import { useSessionStore } from '@/store/sessionStore';
import { useInitiativeStore } from '@/systems/map/store/initiativeStore';
import { useMapStore } from '@/systems/map/store/mapStore';
import {
  useLiveTransformStore,
} from '../store/liveTransformStore';
import { renderItem, itemVisualSignature, renderMapWalls, wallVisualSignature, type RenderContext } from './renderers';
import type { Item, MapItem } from '../types';
import { itemDisplayZIndex, wallDisplayZIndex } from '../zOrder';
import { tokenRendersInThree } from '../token/tokenRenderType';

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
  const liveById = useLiveTransformStore((s) => s.byId);
  const liveTick = useLiveTransformStore((s) => s.tick);
  const activeTurnItemId = useInitiativeStore((s) =>
    s.isActive && s.combatants[s.currentIndex] ? s.combatants[s.currentIndex]!.tokenId : undefined
  );
  const viewMode = useMapStore((s) => s.viewMode);

  const containers = useRef<Map<string, Container>>(new Map());
  const wallContainers = useRef<Map<string, Container>>(new Map());
  const signatures = useRef<Map<string, string>>(new Map());
  const wallSignatures = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    if (!appReady) {
      for (const c of containers.current.values()) c.destroy({ children: true });
      for (const c of wallContainers.current.values()) c.destroy({ children: true });
      containers.current.clear();
      wallContainers.current.clear();
      signatures.current.clear();
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
      selectedIds,
      ...(activeTurnItemId ? { activeTurnItemId } : {}),
    };
    const activeMap = getActiveMap();

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
      // 3D view: token bodies in Three.js. 2D model tokens: invisible Pixi bounds + Three mesh.
      const threeBodyOnly =
        item.type === 'token' &&
        viewMode === '3d' &&
        tokenRendersInThree(item, viewMode);
      if (threeBodyOnly) {
        const stale = containers.current.get(item.id);
        if (stale) {
          stale.destroy({ children: true });
          containers.current.delete(item.id);
          signatures.current.delete(item.id);
        }
        continue;
      }

      let c = containers.current.get(item.id);
      if (!c || c.parent !== layer) {
        c = new Container();
        c.label = `item_${item.id}`;
        c.eventMode = 'none';
        layer.addChild(c);
        containers.current.set(item.id, c);
      }

      // Rebuild children only when visual data changed.
      const sig = itemVisualSignature(item, ctx);
      const prevSig = signatures.current.get(item.id);
      if (prevSig !== sig) {
        renderItem(c, item, ctx);
        signatures.current.set(item.id, sig);
      }

      // Transform — merge live drag offsets for fog vision alignment.
      const live = liveById[item.id];
      const drawX = live?.x ?? item.x;
      const drawY = live?.y ?? item.y;
      const drawW = live?.width ?? item.width;
      const drawH = live?.height ?? item.height;
      const drawRot = live?.rotation ?? item.rotation;
      c.pivot.set(item.width / 2, item.height / 2);
      c.scale.set(drawW / item.width, drawH / item.height);
      c.position.set(drawX + drawW / 2, drawY + drawH / 2);
      c.rotation = (drawRot * Math.PI) / 180;
      c.zIndex = itemDisplayZIndex(item);

      // Visibility / ghosting
      const show = item.visible || gm;
      const alpha = item.visible || !gm ? 1 : 0.35;

      c.visible = show;
      c.alpha = show ? alpha : 0;

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
      wallSignatures.current.clear();
    };
  }, []);
}

/** Returns the live PixiJS container for an item (used by interaction hooks). */
export function getItemContainer(layer: Container | null, id: string): Container | null {
  if (!layer) return null;
  return (layer.getChildByLabel(`item_${id}`) as Container) ?? null;
}
