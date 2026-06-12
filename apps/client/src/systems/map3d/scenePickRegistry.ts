import * as THREE from 'three';
import { useMapStore } from '@/systems/map/store/mapStore';
import type { SceneCameraState } from './sceneCameraRef';
import { syncPerspectiveCamera } from './perspectiveCameraSync';

const pickRoots = new Set<THREE.Object3D>();

const ndc = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
const orthoCam = new THREE.OrthographicCamera();

export function registerPickRoot(root: THREE.Object3D): () => void {
  pickRoots.add(root);
  return () => pickRoots.delete(root);
}

function cameraFromState(state: SceneCameraState, rect: DOMRect): THREE.Camera {
  if (state.type === 'perspective') {
    return syncPerspectiveCamera(state, rect.width / Math.max(rect.height, 1));
  }

  orthoCam.left = state.left;
  orthoCam.right = state.right;
  orthoCam.top = state.top;
  orthoCam.bottom = state.bottom;
  orthoCam.near = 0.1;
  orthoCam.far = 8000;
  orthoCam.position.set(state.position.x, state.position.y, state.position.z);
  orthoCam.up.set(0, 0, -1);
  orthoCam.rotation.set(-Math.PI / 2, 0, 0);
  orthoCam.updateMatrixWorld();
  orthoCam.updateProjectionMatrix();
  return orthoCam;
}

/** Raycast pick volumes; returns item id (userData.pickId) closest to camera. */
export function pickSceneItemId(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  cam: SceneCameraState,
): string | null {
  if (pickRoots.size === 0 || rect.width <= 0 || rect.height <= 0) return null;

  const viewMode = useMapStore.getState().viewMode;
  if (viewMode === '3d' && cam.type !== 'perspective') return null;

  ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;

  const camera = cameraFromState(cam, rect);
  raycaster.setFromCamera(ndc, camera);

  const hits: THREE.Intersection[] = [];
  for (const root of pickRoots) {
    root.updateWorldMatrix(true, true);
    hits.push(...raycaster.intersectObject(root, true));
  }
  if (hits.length === 0) return null;

  hits.sort((a, b) => a.distance - b.distance);
  for (const hit of hits) {
    let obj: THREE.Object3D | null = hit.object;
    while (obj) {
      const pickId = obj.userData?.pickId as string | undefined;
      if (pickId) return pickId;
      obj = obj.parent;
    }
  }
  return null;
}
