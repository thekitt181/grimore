import { useEffect, useRef, useState } from 'react';
import { Container } from 'pixi.js';
import { isMobileClient } from '@/lib/socket';
import {
  isThreeCanvasHealthy,
  THREE_READY_EVENT,
  THREE_UNHEALTHY_EVENT,
} from '@/systems/map3d/threeCanvasHealth';
import { useItemStore, getActiveMap } from '../store/itemStore';
import { useSessionStore } from '@/store/sessionStore';
import { useInitiativeStore } from '@/systems/map/store/initiativeStore';
import { useMapStore } from '@/systems/map/store/mapStore';
import {
  useLiveTransformStore,
} from '../store/liveTransformStore';
import {
  renderItem, itemVisualSignature, renderMapWalls, wallVisualSignature,
  updateTokenOverlay, tokenOverlayVisualSignature,
  type RenderContext,
} from './renderers';
import type { Item, MapItem } from '../types';
import { itemDisplayZIndex, wallDisplayZIndex } from '../zOrder';
import { tokenRendersInThree } from '../token/tokenRenderType';
import { sceneRefs } from '../sceneRefs';
import { emitItemUpdate } from '../sceneSync';
import { dungeonWallStretch, scaledMapGeometry } from '@/systems/map/wallUtils';
import { displayWalls, doorWallsSignature } from '@/systems/map/props/doorCollision';
import { clientVisibleTokenIdSet } from '../sceneMapsForClient';
import { resolveItemBounds } from '@/systems/map3d/sceneItemBounds';
import { registerPixiToken } from '@/systems/scene/token/remotePoseApply';
import { getDragLivePosition, hasDragLivePositions } from '../interaction/dragLivePositions';
import { getWalkPose, WALK_POSE_FRESH_MS } from '@/systems/scene/token/walkPoseBus';
import { isItemDragActive } from '../interaction/selectionDragState';

function itemParentLayer(
  item: Item,
  itemsLayer: Container,
  tokenLayer: Container | null,
): Container {
  if (item.type === 'token' && tokenLayer) return tokenLayer;
  return itemsLayer;
}

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
  tokenLayerRef: React.RefObject<Container | null>,
  appReady: boolean,
) {
  const items   = useItemStore((s) => s.items);
  const selectedIds = useItemStore((s) => s.selectedIds);
  const activeMapId = useItemStore((s) => s.activeMapId);
  const selectedWallIndices = useItemStore((s) => s.selectedWallIndices);
  /** Bumps when FP walk / prop live transforms stream — keep Pixi feet in sync. */
  const liveTick = useLiveTransformStore((s) => s.tick);
  const myRole  = useSessionStore((s) => s.myRole);
  const activeTurnItemId = useInitiativeStore((s) =>
    s.isActive && s.combatants[s.currentIndex] ? s.combatants[s.currentIndex]!.tokenId : undefined
  );
  const viewMode = useMapStore((s) => s.viewMode);
  const gm2dEditorOpen = useMapStore((s) => s.gm2dEditorOpen);
  const activeTool = useMapStore((s) => s.activeTool);
  const fogRevision = useMapStore((s) => s.fogRevision);
  const myUserId = useSessionStore((s) => s.myUserId);

  const containers = useRef<Map<string, Container>>(new Map());
  const wallContainers = useRef<Map<string, Container>>(new Map());
  const signatures = useRef<Map<string, string>>(new Map());
  const overlaySignatures = useRef<Map<string, string>>(new Map());
  const wallSignatures = useRef<Map<string, string>>(new Map());
  // Last computed fog-visible token id set (null = GM / no fog filter). Cached so
  // the transform render effect can respect fog during drag without recomputing.
  const fogVisibleIdsRef = useRef<Set<string> | null>(null);
  const [threeHealthTick, setThreeHealthTick] = useState(0);

  useEffect(() => {
    const bump = () => setThreeHealthTick((t) => t + 1);
    window.addEventListener(THREE_READY_EVENT, bump);
    window.addEventListener(THREE_UNHEALTHY_EVENT, bump);
    return () => {
      window.removeEventListener(THREE_READY_EVENT, bump);
      window.removeEventListener(THREE_UNHEALTHY_EVENT, bump);
    };
  }, []);

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
    const tokenLayer = tokenLayerRef.current;
    if (!layer) return;

    layer.sortableChildren = true;
    if (tokenLayer) tokenLayer.sortableChildren = true;
    const mobileMapUnderlay = viewMode === '3d' && isMobileClient();
    const pixiTokenFallback = viewMode === '3d' && isMobileClient() && !isThreeCanvasHealthy();
    const gm2dEditor = viewMode === '3d' && gm2dEditorOpen && myRole === 'GM';
    const gm: boolean = myRole === 'GM';
    const ctx: RenderContext = {
      gm,
      viewMode,
      selectedIds,
      pixiTokenFallback,
      gm2dEditor,
      ...(activeTurnItemId ? { activeTurnItemId } : {}),
    };
    const activeMap = getActiveMap();
    const liveById = useLiveTransformStore.getState().byId;

    const liveIds = new Set(Object.keys(items));
    const liveMapIds = new Set(
      Object.values(items).filter((i): i is MapItem => i.type === 'map').map((m) => m.id),
    );

    // Remove containers for deleted items
    for (const [id, c] of containers.current) {
      if (!liveIds.has(id)) {
        registerPixiToken(id, null);
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
      // 3D view: token bodies in Three.js — except the GM live 2D editor, which needs full Pixi tokens.
      const threeBodyOnly =
        item.type === 'token' &&
        viewMode === '3d' &&
        !gm2dEditor &&
        (Boolean(item.modelUrl) || (tokenRendersInThree(item, viewMode) && !pixiTokenFallback));
      if (threeBodyOnly) {
        const stale = containers.current.get(item.id);
        if (stale) {
          registerPixiToken(item.id, null);
          stale.destroy({ children: true });
          containers.current.delete(item.id);
          signatures.current.delete(item.id);
          overlaySignatures.current.delete(item.id);
        }
        continue;
      }

      let c = containers.current.get(item.id);
      const parent = itemParentLayer(item, layer, tokenLayer);
      if (!c) {
        c = new Container();
        c.label = `item_${item.id}`;
        c.eventMode = 'none';
        containers.current.set(item.id, c);
      }
      if (c.parent !== parent) {
        c.parent?.removeChild(c);
        parent.addChild(c);
      }
      if (item.type === 'token') registerPixiToken(item.id, c);

      // Rebuild children only when visual data changed.
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

      // Transform — merge live drag offsets (drag ref + live store).
      // Mid-walk: mesh apply owns x/y — do not snap back to item store.
      const b = resolveItemBounds(item, liveById[item.id]);
      c.pivot.set(item.width / 2, item.height / 2);
      c.scale.set(b.width / item.width, b.height / item.height);
      const walk = item.type === 'token' ? getWalkPose(item.id) : undefined;
      const walkOwned = Boolean(
        item.type === 'token'
        && !getDragLivePosition(item.id)
        && walk
        && performance.now() - walk.at < WALK_POSE_FRESH_MS,
      );
      if (!walkOwned) {
        c.position.set(b.cx, b.cz);
        c.rotation = (b.rotation * Math.PI) / 180;
      }
      c.zIndex = itemDisplayZIndex(item);

      // Visibility — hidden items are GM-only ghosts. Respect the cached fog set
      // so dragging (which runs this effect) can't reveal fog-hidden tokens.
      const fogIds = fogVisibleIdsRef.current;
      const inFogVision = item.type !== 'token' || fogIds == null || fogIds.has(item.id);
      const show = (item.visible !== false || gm) && inFogVision;
      const alpha = item.visible !== false || !gm ? 1 : 0.35;

      if (viewMode === '3d') {
        if (gm2dEditor) {
          // Live 2D editor: Pixi sits above the Three underlay (z-index). Flat tokens
          // stay in Pixi so they aren't depth-buried by the GLB map; GLB minis stay
          // hidden here and draw lifted in the underlay.
          if (item.type === 'token') {
            const showPixiToken = !item.modelUrl;
            c.visible = show && showPixiToken;
            c.alpha = show && showPixiToken ? alpha : 0;
          } else {
            c.visible = show;
            c.alpha = show ? alpha : 0;
          }
        } else if (item.type === 'map' && mobileMapUnderlay) {
          c.visible = show;
          c.alpha = show ? alpha : 0;
        } else if (item.type === 'token') {
          const showPixiToken = pixiTokenFallback && !item.modelUrl;
          c.visible = show && showPixiToken;
          c.alpha = show && showPixiToken ? alpha : 0;
        } else if (item.type === 'image') {
          c.visible = false;
          c.alpha = 0;
        } else {
          c.visible = false;
          c.alpha = 0;
        }
      } else {
        if (item.type === 'map' && (item as MapItem).modelUrl) {
          // 2D: Three.js draws the GLB — hide the grey Pixi map chrome (grid/border box).
          c.visible = false;
          c.alpha = 0;
        } else {
          c.visible = show;
          c.alpha = show ? alpha : 0;
        }
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
        const isActiveMap = activeMap?.id === map.id;
        const wallSel = isActiveMap ? selectedWallIndices : [];
        // Open doors cut a gap in the red line; closed restores it (display only).
        const wallsDraw = displayWalls(map, items);
        const wallSig =
          wallVisualSignature(map.id, wallsDraw, wallSel)
          + `|doors:${doorWallsSignature(map, items)}`;
        if (wallSignatures.current.get(map.id) !== wallSig) {
          // Selection indices refer to authored map.walls — only highlight when lists match.
          const authored = map.walls ?? [];
          const selSet =
            wallsDraw.length === authored.length
              ? new Set(wallSel)
              : new Set<number>();
          renderMapWalls(wc, wallsDraw, selSet);
          wallSignatures.current.set(map.id, wallSig);
        }
        const wallBounds = resolveItemBounds(map, liveById[map.id]);
        wc.pivot.set(map.width / 2, map.height / 2);
        wc.scale.set(
          map.width > 0 ? wallBounds.width / map.width : 1,
          map.height > 0 ? wallBounds.height / map.height : 1,
        );
        wc.position.set(wallBounds.cx, wallBounds.cz);
        wc.rotation = (wallBounds.rotation * Math.PI) / 180;
        wc.zIndex = wallDisplayZIndex(map.zIndex);
        // 2D: wall lines for DM and players. 3D: extruded meshes; Pixi walls only while GM edits.
        const showWallOverlay =
          viewMode !== '3d'
          || (gm && (activeTool === 'wall' || gm2dEditor));
        if (showWallOverlay) {
          wc.visible = true;
          wc.alpha = map.visible ? 1 : 0.35;
        } else {
          wc.visible = false;
        }
      }
    }

    layer.sortChildren();
    tokenLayer?.sortChildren();
  }, [
    items,
    liveTick,
    selectedIds,
    activeMapId,
    selectedWallIndices,
    myRole,
    activeTurnItemId,
    viewMode,
    gm2dEditorOpen,
    activeTool,
    threeHealthTick,
    myUserId,
    appReady,
    layerRef,
    tokenLayerRef,
  ]);

  // Fog token visibility — decoupled from transforms so drag stays smooth.
  useEffect(() => {
    if (!appReady) return;
    if (isItemDragActive() || hasDragLivePositions()) return;

    const gm: boolean = myRole === 'GM';
    const fogVisibleTokenIds = clientVisibleTokenIdSet(items, gm);
    fogVisibleIdsRef.current = fogVisibleTokenIds;
    const pixiTokenFallback = viewMode === '3d' && isMobileClient() && !isThreeCanvasHealthy();
    const gm2dEditor = viewMode === '3d' && gm2dEditorOpen && gm;

    for (const item of Object.values(items) as Item[]) {
      if (item.type !== 'token') continue;
      const c = containers.current.get(item.id);
      if (!c) continue;

      const inFogVision = fogVisibleTokenIds == null || fogVisibleTokenIds.has(item.id);
      const show = (item.visible !== false || gm) && inFogVision;
      const alpha = item.visible !== false || !gm ? 1 : 0.35;

      if (viewMode === '3d') {
        // Live 2D editor: flat tokens in Pixi (above underlay). Else mobile Three fallback.
        const showPixiToken = gm2dEditor
          ? !item.modelUrl
          : (pixiTokenFallback && !item.modelUrl);
        c.visible = show && showPixiToken;
        c.alpha = show && showPixiToken ? alpha : 0;
      } else {
        c.visible = show;
        c.alpha = show ? alpha : 0;
      }
    }
  }, [
    fogRevision,
    items,
    myRole,
    myUserId,
    selectedIds,
    activeMapId,
    viewMode,
    gm2dEditorOpen,
    threeHealthTick,
    appReady,
  ]);

  // Generated maps remember walls in the original image pixels. Stretch them once
  // so a resized picture and its red wall outline share the same size.
  useEffect(() => {
    if (myRole !== 'GM') return;
    const live = useLiveTransformStore.getState().byId;
    for (const item of Object.values(items)) {
      if (item.type !== 'map' || live[item.id]?.width != null) continue;
      const stretch = dungeonWallStretch(item);
      if (!stretch) continue;
      const patch = scaledMapGeometry(item, stretch.sx, stretch.sy) as Partial<Item>;
      useItemStore.getState().updateItem(item.id, patch);
      emitItemUpdate([{ id: item.id, patch }]);
    }
  }, [items, myRole]);

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
export function getWallContainer(layer: Container | null, id: string): Container | null {
  if (!layer) return null;
  return (layer.getChildByLabel(`walls_${id}`) as Container) ?? null;
}

export function getItemContainer(layer: Container | null, id: string): Container | null {
  const label = `item_${id}`;
  const tokenLayer = sceneRefs.tokens.current;
  if (tokenLayer) {
    const onTokens = tokenLayer.getChildByLabel(label) as Container | null;
    if (onTokens) return onTokens;
  }
  if (!layer) return null;
  return (layer.getChildByLabel(label) as Container) ?? null;
}
