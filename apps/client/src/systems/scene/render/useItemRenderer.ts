import { useEffect, useRef } from 'react';
import { Container } from 'pixi.js';
import { useItemStore } from '../store/itemStore';
import { useSessionStore } from '@/store/sessionStore';
import { useInitiativeStore } from '@/systems/map/store/initiativeStore';
import { renderItem, itemVisualSignature, renderMapWalls, wallVisualSignature, type RenderContext } from './renderers';
import type { Item, MapItem } from '../types';
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
  const myRole  = useSessionStore((s) => s.myRole);
  const activeTurnItemId = useInitiativeStore((s) =>
    s.isActive && s.combatants[s.currentIndex] ? s.combatants[s.currentIndex]!.tokenId : undefined
  );

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
    const ctx: RenderContext = { gm, ...(activeTurnItemId ? { activeTurnItemId } : {}) };

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
      let c = containers.current.get(item.id);
      if (!c || c.parent !== layer) {
        c = new Container();
        c.label = `item_${item.id}`;
        c.eventMode = 'none';
        layer.addChild(c);
        containers.current.set(item.id, c);
      }

      // Rebuild children only when visual data changed
      const sig = itemVisualSignature(item, ctx);
      if (signatures.current.get(item.id) !== sig) {
        renderItem(c, item, ctx);
        signatures.current.set(item.id, sig);
      }

      // Transform (scale normalised — interaction hooks may set it live during drags)
      c.scale.set(1, 1);
      c.pivot.set(item.width / 2, item.height / 2);
      c.position.set(item.x + item.width / 2, item.y + item.height / 2);
      c.rotation = (item.rotation * Math.PI) / 180;
      c.zIndex = itemDisplayZIndex(item);

      // Visibility / ghosting
      if (item.visible) {
        c.visible = true;
        c.alpha = 1;
      } else if (gm) {
        c.visible = true;
        c.alpha = 0.35;
      } else {
        c.visible = false;
      }

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
        const wallSig = wallVisualSignature(map.id, map.walls ?? []);
        if (wallSignatures.current.get(map.id) !== wallSig) {
          renderMapWalls(wc, map.walls ?? []);
          wallSignatures.current.set(map.id, wallSig);
        }
        wc.scale.set(1, 1);
        wc.pivot.set(map.width / 2, map.height / 2);
        wc.position.set(map.x + map.width / 2, map.y + map.height / 2);
        wc.rotation = (map.rotation * Math.PI) / 180;
        wc.zIndex = wallDisplayZIndex(map.zIndex);
        if (map.visible) {
          wc.visible = true;
          wc.alpha = 1;
        } else if (gm) {
          wc.visible = true;
          wc.alpha = 0.35;
        } else {
          wc.visible = false;
        }
      }
    }
  }, [items, myRole, activeTurnItemId, appReady]);

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
