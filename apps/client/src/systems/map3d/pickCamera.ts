import * as THREE from 'three';
import { sceneRefs } from '@/systems/scene/sceneRefs';
import { useMapStore } from '@/systems/map/store/mapStore';
import { sceneCameraRef, type SceneCameraState } from './sceneCameraRef';
import { syncOrthographicCamera } from './orthographicCameraSync';
import { syncPerspectiveCamera } from './perspectiveCameraSync';

/** DOM rect of the Three.js canvas — use for 3D raycast / screen projection NDC. */
export function getThreeCanvasRect(): DOMRect | null {
  return sceneRefs.threeCanvas.current?.getBoundingClientRect() ?? null;
}

/** Pick/projection rect: Three canvas in 3D view, otherwise the map interaction layer. */
export function getPickCanvasRect(): DOMRect | null {
  if (useMapStore.getState().viewMode === '3d') {
    const three = getThreeCanvasRect();
    if (three) return three;
  }
  const interaction = sceneRefs.interactionRoot.current;
  if (interaction) return interaction.getBoundingClientRect();
  const app = sceneRefs.app.current;
  if (app) return app.canvas.getBoundingClientRect();
  return getThreeCanvasRect();
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
