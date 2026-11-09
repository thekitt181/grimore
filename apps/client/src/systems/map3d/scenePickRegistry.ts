import * as THREE from 'three';
import { useMapStore } from '@/systems/map/store/mapStore';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { mapPickRank } from '@/systems/map/library/modularKits';
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

  const items = useItemStore.getState().items;
  const seen = new Set<string>();
  let lockedToken: string | null = null;
  let propId: string | null = null;
  const maps: typeof items[string][] = [];

  for (const hit of hits) {
    let obj: THREE.Object3D | null = hit.object;
    let pickId: string | undefined;
    while (obj) {
      pickId = obj.userData?.pickId as string | undefined;
      if (pickId) break;
      obj = obj.parent;
    }
    if (!pickId || seen.has(pickId)) continue;
    seen.add(pickId);
    const item = items[pickId];
    if (!item) continue;
    if (item.type === 'token') {
      if (!item.locked) return pickId;
      if (!lockedToken) lockedToken = pickId;
      continue;
    }
    if (item.type === 'map') {
      maps.push(item);
      continue;
    }
    if (!item.locked && !propId) propId = pickId;
  }

  if (propId) return propId;
  maps.sort((a, b) => mapPickRank(b) - mapPickRank(a));
  if (maps[0]) return maps[0].id;
  return lockedToken;
}
