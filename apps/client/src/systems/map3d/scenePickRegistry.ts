import * as THREE from 'three';
import { useMapStore } from '@/systems/map/store/mapStore';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { sceneCameraRef, type SceneCameraState } from './sceneCameraRef';
import { getPickCanvasRect, resolvePickCamera } from './pickCamera';

const pickRoots = new Set<THREE.Object3D>();

const ndc = new THREE.Vector2();
const raycaster = new THREE.Raycaster();

export function registerPickRoot(root: THREE.Object3D): () => void {
  pickRoots.add(root);
  return () => pickRoots.delete(root);
}

/** Raycast pick volumes; returns item id (userData.pickId) closest to camera. */
export function pickSceneItemId(
  clientX: number,
  clientY: number,
  rect?: DOMRect | null,
  cam?: SceneCameraState | null,
): string | null {
  const pickRect = rect ?? getPickCanvasRect();
  const cameraState = cam ?? sceneCameraRef.current;
  if (!pickRect || !cameraState || pickRoots.size === 0) return null;
  if (pickRect.width <= 0 || pickRect.height <= 0) return null;

  const viewMode = useMapStore.getState().viewMode;
  if (viewMode === '3d' && cameraState.type !== 'orthographic' && cameraState.type !== 'perspective') {
    return null;
  }

  ndc.x = ((clientX - pickRect.left) / pickRect.width) * 2 - 1;
  ndc.y = -((clientY - pickRect.top) / pickRect.height) * 2 + 1;

  const camera = resolvePickCamera(cameraState, pickRect);
  raycaster.setFromCamera(ndc, camera);

  const hits: THREE.Intersection[] = [];
  for (const root of pickRoots) {
    root.updateWorldMatrix(true, true);
    hits.push(...raycaster.intersectObject(root, true));
  }
  if (hits.length === 0) return null;

  hits.sort((a, b) => a.distance - b.distance);

  let fallback: string | null = null;
  for (const hit of hits) {
    let obj: THREE.Object3D | null = hit.object;
    while (obj) {
      const pickId = obj.userData?.pickId as string | undefined;
      if (pickId) {
        const itemType = useItemStore.getState().items[pickId]?.type;
        if (itemType === 'token') return pickId;
        if (!fallback) fallback = pickId;
        break;
      }
      obj = obj.parent;
    }
  }
  return fallback;
}
