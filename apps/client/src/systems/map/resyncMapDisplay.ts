import * as THREE from 'three';
import { getActiveMap } from '@/systems/scene/store/itemStore';
import { sceneRefs } from '@/systems/scene/sceneRefs';
import { useMapStore } from './store/mapStore';
import { applyPixiViewMode } from './applyPixiViewMode';
import { syncMapGridFromItem } from './hooks/useMapViewport';
import { requestFogRepaint, requestSceneVisibilityUpdate } from './fogRepaintBridge';
import { applyOrthographicCameraFromViewport } from '@/systems/map3d/orthographicCameraSync';
import { sceneCameraRef } from '@/systems/map3d/sceneCameraRef';
import { forceThreeDisplaySync } from '@/systems/map3d/threeCanvasHealth';

function forcePixiDisplaySync(): void {
  const app = sceneRefs.app.current;
  if (!app) return;
  const canvas = app.canvas;
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  const resizeable = app as { resize?: () => void; queueResize?: () => void };
  resizeable.queueResize?.();
  if (typeof resizeable.resize === 'function') {
    resizeable.resize();
  } else {
    const host = canvas.parentElement;
    if (host) {
      app.renderer.resize(
        Math.max(1, host.clientWidth),
        Math.max(1, host.clientHeight),
      );
    }
  }
  const world = sceneRefs.world.current;
  if (world) {
    world.hitArea = app.screen;
    useMapStore.getState().setViewport({
      x: world.x,
      y: world.y,
      scale: world.scale.x,
    });
  }
}

function applyLiveCamera(): void {
  const cam = sceneCameraRef.liveCamera;
  const app = sceneRefs.app.current;
  if (!(cam instanceof THREE.OrthographicCamera) || !app) return;
  applyOrthographicCameraFromViewport(cam, app.screen.width, app.screen.height);
}

function syncOnce(): void {
  forcePixiDisplaySync();
  forceThreeDisplaySync();
  applyPixiViewMode(useMapStore.getState().viewMode === '3d');
  const map = getActiveMap();
  if (map) syncMapGridFromItem(map);
  applyLiveCamera();
  requestFogRepaint();
  requestSceneVisibilityUpdate();
}

/** Re-lock mouse, camera, tokens, and props to the map after CSS/WebGL drift. */
export function resyncMapDisplay(): void {
  syncOnce();
  requestAnimationFrame(() => {
    syncOnce();
    requestAnimationFrame(syncOnce);
  });
}
