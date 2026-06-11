import { useCallback, useEffect, useRef, useState } from 'react';
import { Container, Application } from 'pixi.js';
import { v4 as uuidv4 } from 'uuid';
import { usePixiApp } from './hooks/usePixiApp';
import { useMapViewport, fitMapToScreen, applyViewport } from './hooks/useMapViewport';
import { useFogRenderer } from './hooks/useFogRenderer';
import { useMapFogOverlay } from './hooks/useMapFogOverlay';
import { useMapMeasure } from './hooks/useMapMeasure';
import { useDrawingTool } from './hooks/useDrawingTool';
import { useCalibrateGrid } from './hooks/useCalibrateGrid';
import { useMapStore } from './store/mapStore';
import { useItemStore, getActiveMap } from '@/systems/scene/store/itemStore';
import { useItemRenderer } from '@/systems/scene/render/useItemRenderer';
import { useSelectionTool } from '@/systems/scene/interaction/useSelectionTool';
import { useAttackTargetPick } from '@/systems/combat/useAttackTargetPick';
import { useAoePlacement } from '@/systems/combat/useAoePlacement';
import { useTransformControls } from '@/systems/scene/interaction/useTransformControls';
import { sceneRefs } from '@/systems/scene/sceneRefs';
import { DEFAULT_MAP_GRID_SIZE, defaultMapGrid, gridSizeForMap } from '@/systems/scene/types';
import { emitItemAdd, emitItemUpdate, emitItemsSync } from '@/systems/scene/sceneSync';
import { applyFogData, emitFogSync, flushFogScene, hydrateFogFromServer, parseFogCells, resetFogPushBaseline, restoreFogFromLocal } from '@/systems/scene/fogSync';
import { mergeFogIntoCells } from '@/systems/scene/fogMerge';
import type { FogUpdatePayload } from '@grimoire/shared';
import { bindFogActiveSocket, syncFogActiveToSession } from '@/systems/scene/fogActiveSync';
import { useParams } from 'react-router-dom';
import {
  addDeletedIds,
  getPersistSessionId,
  loadDeletedIds,
  loadItemsLocal,
  loadViewportLocal,
  persistItemsLocal,
} from '@/systems/scene/sessionPersistence';
import { mergeSceneItems, sameSceneItemSnapshot, sanitizePersistedItems } from '@/systems/scene/mergeSceneItems';
import { fileToDataUrl } from '@/lib/imagePersistence';
import { useWallTool } from './hooks/useWallTool';
import { useEraserTool } from './hooks/useEraserTool';
import { useDeleteKey } from './hooks/useDeleteKey';
import type { Item, MapItem, TokenItem } from '@/systems/scene/types';
import { MapCategoryWheel, type ImageCategory } from './MapCategoryWheel';
import { useSessionStore } from '@/store/sessionStore';
import { getSocket } from '@/lib/socket';
import { Map3DCanvas } from '@/systems/map3d/Map3DCanvas';

// Back-compat alias — some modules still import mapLayerRefs.
export const mapLayerRefs = sceneRefs;

interface PendingDrop {
  screenX: number; screenY: number;
  worldX:  number; worldY:  number;
  url: string;
}

function createDefaultMap(): MapItem {
  return {
    id: uuidv4(), type: 'map', x: 0, y: 0, rotation: 0,
    width: 2560, height: 1920, zIndex: 0, locked: false, visible: true,
    backgroundUrl: null, gridSize: DEFAULT_MAP_GRID_SIZE, gridType: 'square',
    gridColor: 0x2a2a3a, gridOpacity: 0.8, gridOffsetX: 0, gridOffsetY: 0, showGrid: true,
    walls: [],
  };
}

export function MapCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [appReady, setAppReady] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [pendingDrop, setPendingDrop] = useState<PendingDrop | null>(null);

  const { sessionId: routeSessionId } = useParams<{ sessionId: string }>();
  const storeSessionId = useSessionStore((s) => s.sessionId);
  const sessionId = storeSessionId ?? routeSessionId ?? null;
  const viewMode = useMapStore((s) => s.viewMode);
  const items = useItemStore((s) => s.items);
  const initialSyncRef = useRef({ received: false, hadItems: false, pushed: false });
  const fogSyncedRef = useRef(false);
  const viewportInitializedRef = useRef(false);

  useEffect(() => {
    initialSyncRef.current = { received: false, hadItems: false, pushed: false };
    fogSyncedRef.current = false;
    viewportInitializedRef.current = false;
  }, [sessionId]);

  // Restore last saved scene from localStorage before the server snapshot arrives.
  // Only reset when sessionId changes — NOT when myUserId arrives (that was wiping fog state).
  useEffect(() => {
    if (!sessionId) return;
    useItemStore.getState().reset();
    useMapStore.getState().reset();

    const localItems = loadItemsLocal(sessionId);
    if (localItems) {
      useItemStore.getState().setItems(localItems);
    } else if (useSessionStore.getState().myRole === 'GM') {
      useItemStore.getState().addItem(createDefaultMap());
    }

    restoreFogFromLocal(sessionId);
  }, [sessionId]);

  // Flush fog to storage + server before the page unloads.
  useEffect(() => {
    if (!sessionId) return;
    const save = () => flushFogScene(sessionId);
    window.addEventListener('pagehide', save);
    window.addEventListener('beforeunload', save);
    const onHide = () => {
      if (document.visibilityState === 'hidden') save();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', save);
      window.removeEventListener('beforeunload', save);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [sessionId]);

  // ── PixiJS initialisation ─────────────────────────────────────────────────
  const onReady = useCallback((app: Application) => {
    sceneRefs.app.current = app;

    const world = new Container();
    world.label = 'world';
    world.eventMode = 'static';
    world.hitArea = app.screen;
    app.stage.addChild(world);
    sceneRefs.world.current = world;

    const itemsLayer = new Container(); itemsLayer.label = 'items'; itemsLayer.sortableChildren = true; world.addChild(itemsLayer);
    const fogLayer   = new Container(); fogLayer.label = 'fog'; world.addChild(fogLayer);
    const drawPrev   = new Container(); drawPrev.label = 'drawPreview'; world.addChild(drawPrev);
    const measure    = new Container(); measure.label = 'measure'; world.addChild(measure);
    const overlay    = new Container(); overlay.label = 'overlay'; world.addChild(overlay);

    itemsLayer.eventMode = 'none';
    fogLayer.eventMode = 'none';
    drawPrev.eventMode = 'none';
    measure.eventMode = 'none';
    overlay.eventMode = 'none';

    sceneRefs.items.current = itemsLayer;
    sceneRefs.fog.current = fogLayer;
    sceneRefs.drawPreview.current = drawPrev;
    sceneRefs.measure.current = measure;
    sceneRefs.overlay.current = overlay;

    const sid = getPersistSessionId();
    const savedVp = sid ? loadViewportLocal(sid) : null;
    if (savedVp) {
      applyViewport(world, savedVp);
      viewportInitializedRef.current = true;
    } else {
      fitMapToScreen(app, world);
      viewportInitializedRef.current = true;
    }
    setAppReady(true);

    return () => {
      setAppReady(false);
      sceneRefs.app.current = null;
      sceneRefs.world.current = null;
      sceneRefs.items.current = null;
      sceneRefs.fog.current = null;
      sceneRefs.drawPreview.current = null;
      sceneRefs.measure.current = null;
      sceneRefs.overlay.current = null;
    };
  }, []);

  const appRef = usePixiApp(containerRef, onReady);

  // ── Socket listeners (generic item sync) ──────────────────────────────────
  useEffect(() => {
    if (!sessionId) return;

    const persistLocal = () => {
      if (!sessionId) return;
      persistItemsLocal(sessionId, Object.values(useItemStore.getState().items) as Item[]);
    };
    const onAdd    = ({ item }: { item: unknown }) => {
      useItemStore.getState().upsertItem(item as Item);
      persistLocal();
    };
    const onUpdate = ({ patches }: { patches: Array<{ id: string; patch: Partial<Item> }> }) => {
      useItemStore.getState().updateItems(patches);
      persistLocal();
    };
    const onRemove = ({ ids }: { ids: string[] }) => {
      addDeletedIds(sessionId, ids);
      useItemStore.getState().removeItems(ids);
      persistLocal();
    };
    const onSync   = ({ items: list }: { items: unknown[] }) => {
      initialSyncRef.current.received = true;
      const serverItems = sanitizePersistedItems(list as Item[]);
      const localItems = loadItemsLocal(sessionId) ?? (
        Object.values(useItemStore.getState().items) as Item[]
      );
      const deletedIds = loadDeletedIds(sessionId);
      initialSyncRef.current.hadItems = serverItems.length > 0 || localItems.length > 0;

      if (serverItems.length > 0 || localItems.length > 0) {
        const merged = serverItems.length > 0
          ? mergeSceneItems(serverItems, localItems, deletedIds)
          : localItems.filter((i) => !deletedIds.has(i.id));
        const current = useItemStore.getState().items;
        if (!sameSceneItemSnapshot(merged, current)) {
          useItemStore.getState().setItems(merged);
        }
        if (sessionId) persistItemsLocal(sessionId, merged);
        if (serverItems.length === 0 && localItems.length > 0 && !initialSyncRef.current.pushed) {
          initialSyncRef.current.pushed = true;
          emitItemsSync(merged);
        }
        return;
      }

      if (useSessionStore.getState().myRole === 'GM') {
        const map = createDefaultMap();
        useItemStore.getState().addItem(map);
        initialSyncRef.current.pushed = true;
        emitItemsSync([map]);
      }
    };
    const onFog = (payload: FogUpdatePayload) => {
      const isGM = useSessionStore.getState().myRole === 'GM';
      const current = useMapStore.getState().revealedCells;

      if (payload.fogData != null) {
        const incoming = parseFogCells(payload.fogData);
        if (isGM && incoming.size === 0 && current.size > 0) return;
        if (!isGM) {
          const merged = mergeFogIntoCells(current, payload);
          useMapStore.getState().setRevealedCells(merged, { persist: false });
          resetFogPushBaseline(merged);
          return;
        }
        applyFogData(payload.fogData);
        resetFogPushBaseline();
        return;
      }

      if (payload.added?.length || payload.removed?.length) {
        const merged = mergeFogIntoCells(current, payload);
        useMapStore.getState().setRevealedCells(merged, { persist: false });
        resetFogPushBaseline(merged);
      }
    };
    const onFogSync = ({ fogData }: { fogData: string }) => {
      fogSyncedRef.current = true;
      if (useSessionStore.getState().myRole === 'GM') {
        hydrateFogFromServer(fogData, sessionId);
      } else {
        applyFogData(fogData);
      }
    };
    // When players join, GM pushes scene snapshot (debounced so bursts coalesce).
    let joinPushTimer: ReturnType<typeof setTimeout> | null = null;
    const onUserJoined = () => {
      if (useSessionStore.getState().myRole !== 'GM') return;
      if (joinPushTimer) clearTimeout(joinPushTimer);
      joinPushTimer = setTimeout(() => {
        joinPushTimer = null;
        emitItemsSync(Object.values(useItemStore.getState().items) as Item[]);
        emitFogSync();
        syncFogActiveToSession();
      }, 600);
    };

    function attachSceneListeners() {
      const socket = getSocket();
      socket.off('item:add', onAdd as any);
      socket.off('item:update', onUpdate as any);
      socket.off('item:remove', onRemove as any);
      socket.off('items:sync', onSync as any);
      socket.off('map:fogUpdate', onFog as any);
      socket.off('fog:sync', onFogSync as any);
      socket.off('session:userJoined', onUserJoined as any);
      socket.on('item:add', onAdd as any);
      socket.on('item:update', onUpdate as any);
      socket.on('item:remove', onRemove as any);
      socket.on('items:sync', onSync as any);
      socket.on('map:fogUpdate', onFog as any);
      socket.on('fog:sync', onFogSync as any);
      socket.on('session:userJoined', onUserJoined as any);
      bindFogActiveSocket();
    }

    attachSceneListeners();
    const socket = getSocket();
    socket.on('connect', attachSceneListeners);
    const onSocketReady = () => attachSceneListeners();
    window.addEventListener('grimoire:socket-connected', onSocketReady);

    return () => {
      if (joinPushTimer) clearTimeout(joinPushTimer);
      window.removeEventListener('grimoire:socket-connected', onSocketReady);
      getSocket().off('connect', attachSceneListeners);
      getSocket().off('item:add', onAdd as any);
      getSocket().off('item:update', onUpdate as any);
      getSocket().off('item:remove', onRemove as any);
      getSocket().off('items:sync', onSync as any);
      getSocket().off('map:fogUpdate', onFog as any);
      getSocket().off('fog:sync', onFogSync as any);
      getSocket().off('session:userJoined', onUserJoined as any);
    };
  }, [sessionId]);

  // Fit viewport only on first map load — not on every item sync (avoids jump on reconnect).
  useEffect(() => {
    if (!appReady || !sessionId || viewportInitializedRef.current) return;
    const app = sceneRefs.app.current;
    const world = sceneRefs.world.current;
    const map = getActiveMap();
    if (!app || !world || !map) return;
    const savedVp = loadViewportLocal(sessionId);
    if (savedVp) {
      applyViewport(world, savedVp);
    } else {
      fitMapToScreen(app, world);
    }
    viewportInitializedRef.current = true;
  }, [appReady, sessionId, items]);

  // ── Hooks ───────────────────────────────────────────────────────────────
  useMapViewport(appRef, sceneRefs.world, appReady);
  useItemRenderer(sceneRefs.items, appReady);
  useMapFogOverlay(sceneRefs.items, appReady);
  useSelectionTool(appReady);
  useAttackTargetPick(appReady);
  useAoePlacement(appReady);
  useTransformControls(appReady);
  useFogRenderer(appReady);
  useMapMeasure(sceneRefs.measure, sceneRefs.world);
  useDrawingTool(appReady);
  useCalibrateGrid(appReady);
  useWallTool(appReady);
  useEraserTool(appReady);
  useDeleteKey(appReady);

  // ── Fix maps that still use 96px after an image changed their dimensions ─
  const gridFixed = useRef(false);
  useEffect(() => {
    if (!appReady || gridFixed.current) return;
    gridFixed.current = true;
    const store = useItemStore.getState();
    const updates: Array<{ id: string; patch: Partial<Item> }> = [];
    for (const item of Object.values(store.items)) {
      if (item.type !== 'map' || !item.backgroundUrl) continue;
      const expected = gridSizeForMap(item.width, item.height);
      if (item.gridSize === DEFAULT_MAP_GRID_SIZE && expected !== DEFAULT_MAP_GRID_SIZE) {
        const scale = expected / item.gridSize;
        updates.push({
          id: item.id,
          patch: {
            gridSize: expected,
            gridOffsetX: Math.round(item.gridOffsetX * scale),
            gridOffsetY: Math.round(item.gridOffsetY * scale),
          },
        });
      }
    }
    if (updates.length > 0) {
      store.updateItems(updates);
      emitItemUpdate(updates);
    }
  }, [appReady]);

  // ── Mirror active map grid into the scene store (fog/measure/viewport) ────
  useEffect(() => {
    const map = getActiveMap();
    if (!map) return;
    useMapStore.getState().setActiveGrid({
      gridType: map.gridType,
      gridSize: map.gridSize,
      mapWidth: map.width,
      mapHeight: map.height,
      gridColor: map.gridColor,
      gridOpacity: map.gridOpacity,
      gridOffsetX: map.gridOffsetX,
      gridOffsetY: map.gridOffsetY,
      showGrid: map.showGrid,
      mapX: map.x,
      mapY: map.y,
    });
  }, [items]);

  // ── Drag-and-drop image placement ─────────────────────────────────────────
  function getWorldPos(sx: number, sy: number) {
    const world = sceneRefs.world.current;
    const canvas = sceneRefs.app.current?.canvas;
    if (!world || !canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: (sx - rect.left - world.x) / world.scale.x,
      y: (sy - rect.top  - world.y) / world.scale.y,
    };
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setIsDragOver(true);
  }
  function handleDragLeave(e: React.DragEvent) {
    if (!containerRef.current?.contains(e.relatedTarget as Node)) setIsDragOver(false);
  }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    const { x: worldX, y: worldY } = getWorldPos(e.clientX, e.clientY);
    const file = e.dataTransfer.files[0];
    if (file?.type.startsWith('image/')) {
      void fileToDataUrl(file).then((url) => {
        setPendingDrop({ screenX: e.clientX, screenY: e.clientY, worldX, worldY, url });
      });
      return;
    }
    const imageUrl = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
    if (imageUrl && /^https?:\/\//.test(imageUrl)) {
      setPendingDrop({ screenX: e.clientX, screenY: e.clientY, worldX, worldY, url: imageUrl });
    }
  }
  function handleCategorySelect(category: ImageCategory) {
    if (!pendingDrop) return;
    const { url, worldX, worldY } = pendingDrop;
    setPendingDrop(null);
    placeByCategory(category, url, worldX, worldY);
  }

  return (
    <div className="w-full h-full relative" style={{ background: '#0a0a0f' }}>
      {viewMode === '3d' && <Map3DCanvas />}

      <div
        ref={containerRef}
        className="absolute inset-0 w-full h-full"
        style={{
          visibility: viewMode === '3d' ? 'hidden' : 'visible',
          pointerEvents: viewMode === '3d' ? 'none' : 'auto',
        }}
        onDragOver={viewMode === '2d' ? handleDragOver : undefined}
        onDragEnter={viewMode === '2d' ? handleDragOver : undefined}
        onDragLeave={viewMode === '2d' ? handleDragLeave : undefined}
        onDrop={viewMode === '2d' ? handleDrop : undefined}
      />

      {viewMode === '2d' && isDragOver && (
        <div
          className="absolute inset-0 z-50 flex flex-col items-center justify-center pointer-events-none"
          style={{ background: 'rgba(10,10,15,0.75)', border: '3px dashed var(--color-accent-gold)', borderRadius: 4 }}
        >
          <span style={{ fontSize: 48 }}>🗺️</span>
          <p className="font-display text-lg mt-3 tracking-widest" style={{ color: 'var(--color-accent-gold)' }}>
            Drop image to place
          </p>
        </div>
      )}
      {pendingDrop && (
        <MapCategoryWheel
          x={pendingDrop.screenX}
          y={pendingDrop.screenY}
          onSelect={handleCategorySelect}
          onDismiss={() => setPendingDrop(null)}
        />
      )}
    </div>
  );
}

// ─── Drop placement ───────────────────────────────────────────────────────────

function placeByCategory(category: ImageCategory, url: string, worldX: number, worldY: number) {
  const store = useItemStore.getState();

  if (category === 'map') {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => addMapItem(url, img.naturalWidth || 2560, img.naturalHeight || 1920, worldX, worldY);
    img.onerror = () => addMapItem(url, 2560, 1920, worldX, worldY);
    img.src = url;
    return;
  }

  const grid = getActiveMap()?.gridSize ?? DEFAULT_MAP_GRID_SIZE;
  const nameMap: Record<string, string> = { character: 'Character', item: 'Item', prop: 'Prop', other: 'Object' };
  const token: TokenItem = {
    id: uuidv4(), type: 'token', x: worldX - grid / 2, y: worldY - grid / 2, rotation: 0,
    width: grid, height: grid, zIndex: 0, locked: false, visible: true,
    name: nameMap[category] ?? 'Token', imageUrl: url, sizeCells: 1,
    hp: 10, maxHp: 10, tempHp: 0, ac: 10, visionRadius: 12, conditions: [],
  };
  store.addItem(token);
  emitItemAdd(token);
}

function addMapItem(url: string, w: number, h: number, worldX: number, worldY: number) {
  const store = useItemStore.getState();
  const active = getActiveMap();
  // First map with no background → fill it in; otherwise create a new map item.
  if (active && !active.backgroundUrl) {
    const patch: Partial<MapItem> = { backgroundUrl: url, width: w, height: h, ...defaultMapGrid(w, h) };
    store.updateItem(active.id, patch);
    emitItemUpdate([{ id: active.id, patch }]);
    return;
  }
  const map: MapItem = {
    id: uuidv4(), type: 'map', x: worldX, y: worldY, rotation: 0,
    width: w, height: h, zIndex: 0, locked: false, visible: true,
    backgroundUrl: url, ...defaultMapGrid(w, h), gridType: 'square',
    gridColor: 0x2a2a3a, gridOpacity: 0.8, gridOffsetX: 0, gridOffsetY: 0, showGrid: true,
    walls: [],
  };
  store.addItem(map);
  emitItemAdd(map);
}
