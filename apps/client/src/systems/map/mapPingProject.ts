import * as THREE from 'three';
import { useMapStore, isGm2dEditorInteraction } from '@/systems/map/store/mapStore';
import { useFirstPersonStore } from '@/systems/map3d/firstPersonStore';
import { sceneCameraRef } from '@/systems/map3d/sceneCameraRef';
import { getPickCanvasRect } from '@/systems/map3d/pickCamera';
import { pixiWorldToClient } from '@/systems/map3d/pixiScreenCoords';
import { groundHeightAt } from '@/systems/map3d/mapGroundRaycast';

const ndc = new THREE.Vector3();

/** Map world x/y → browser client pixels for the ping overlay. */
export function worldToPingClient(worldX: number, worldY: number): { x: number; y: number } | null {
  const viewMode = useMapStore.getState().viewMode;
  const firstPerson = useFirstPersonStore.getState().enabled && viewMode === '3d';
  const live = sceneCameraRef.liveCamera;
  if ((viewMode === '3d' || firstPerson) && live && !isGm2dEditorInteraction()) {
    const rect = getPickCanvasRect();
    if (rect && rect.width > 0 && rect.height > 0) {
      live.updateMatrixWorld(true);
      const lift = groundHeightAt(worldX, worldY, 0) + 6;
      ndc.set(worldX, lift, worldY).project(live);
      if (!Number.isFinite(ndc.x) || !Number.isFinite(ndc.y) || ndc.z > 1) return null;
      return {
        x: rect.left + (ndc.x * 0.5 + 0.5) * rect.width,
        y: rect.top + (-ndc.y * 0.5 + 0.5) * rect.height,
      };
    }
  }
  return pixiWorldToClient(worldX, worldY);
}
