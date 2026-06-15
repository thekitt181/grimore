import * as THREE from 'three';
import { sceneRefs } from '@/systems/scene/sceneRefs';
import { getMapPointerRect } from './pixiScreenCoords';
import { sceneCameraRef, type SceneCameraState } from './sceneCameraRef';
import { syncOrthographicCamera } from './orthographicCameraSync';
import { syncPerspectiveCamera } from './perspectiveCameraSync';

/** DOM rect of the Three.js canvas (debug / legacy). */
export function getThreeCanvasRect(): DOMRect | null {
  return sceneRefs.threeCanvas.current?.getBoundingClientRect() ?? null;
}

/** Pick/projection rect — always the map interaction layer (matches pan/zoom + clientToWorld). */
export function getPickCanvasRect(): DOMRect | null {
  return getMapPointerRect() ?? getThreeCanvasRect();
}

/** Camera for picking — prefer the live R3F camera so rays match the rendered frame. */
export function resolvePickCamera(state: SceneCameraState, rect: DOMRect): THREE.Camera {
  const live = sceneCameraRef.liveCamera;
  if (live) {
    if (state.type === 'perspective' && live instanceof THREE.PerspectiveCamera) {
      live.updateMatrixWorld(true);
      return live;
    }
    if (state.type === 'orthographic' && live instanceof THREE.OrthographicCamera) {
      live.updateMatrixWorld(true);
      return live;
    }
  }
  if (state.type === 'perspective') {
    return syncPerspectiveCamera(state, rect.width / Math.max(rect.height, 1));
  }
  return syncOrthographicCamera(state);
}
