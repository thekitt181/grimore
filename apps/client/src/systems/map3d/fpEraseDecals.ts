import { useItemStore } from '@/systems/scene/store/itemStore';
import { emitItemRemove } from '@/systems/scene/sceneSync';
import { useSessionStore } from '@/store/sessionStore';
import { useFirstPersonStore } from './firstPersonStore';
import { raycastFpSurface } from './fpSurfaceRaycast';
import type { SurfaceDecalItem } from '@/systems/scene/types';
import type * as THREE from 'three';

let erasing = false;
let lastAt = 0;

function canErase(item: SurfaceDecalItem, isGM: boolean, myUserId: string | null): boolean {
  if (isGM) return true;
  return Boolean(myUserId && item.ownerId === myUserId);
}

function eraseNearHit(scene: THREE.Scene | null): void {
  const hit = raycastFpSurface(scene);
  if (!hit) return;

  const isGM = useSessionStore.getState().myRole === 'GM';
  const myUserId = useSessionStore.getState().myUserId;
  const brush = useFirstPersonStore.getState().brushSize;
  const radius = Math.max(12, brush * 2.5);

  const items = Object.values(useItemStore.getState().items);
  const remove: string[] = [];

  for (const it of items) {
    if (it.type !== 'surfaceDecal') continue;
    if (!canErase(it, isGM, myUserId)) continue;
    if (it.mapId !== hit.mapId) continue;

    if (hit.surface === 'floor' && it.surface === 'floor') {
      // Item bbox in world xz.
      const cx = it.x + it.width / 2;
      const cy = it.y + it.height / 2;
      if (Math.hypot(cx - hit.worldX, cy - hit.worldZ) <= radius + Math.max(it.width, it.height) * 0.5) {
        remove.push(it.id);
      }
      continue;
    }

    if (hit.surface === 'wall' && it.surface === 'wall') {
      // Compare surface-space points to hit along/height.
      for (let i = 0; i + 1 < it.points.length; i += 2) {
        const along = it.points[i]!;
        const h = it.points[i + 1]!;
        if (Math.hypot(along - hit.along, h - hit.height) <= radius) {
          remove.push(it.id);
          break;
        }
      }
    }
  }

  if (remove.length === 0) return;
  useItemStore.getState().removeItems(remove);
  emitItemRemove(remove);
}

export function beginFpErase(scene: THREE.Scene | null): void {
  if (erasing) return;
  if (useFirstPersonStore.getState().tool !== 'erase') return;
  erasing = true;
  lastAt = 0;
  eraseNearHit(scene);
}

export function sampleFpErase(scene: THREE.Scene | null): void {
  if (!erasing) return;
  const now = performance.now();
  if (now - lastAt < 40) return;
  lastAt = now;
  eraseNearHit(scene);
}

export function endFpErase(): void {
  erasing = false;
}

export function isFpErasing(): boolean {
  return erasing;
}

export function cancelFpErase(): void {
  erasing = false;
}
