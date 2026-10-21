import { v4 as uuidv4 } from 'uuid';
import type { SurfaceDecalItem } from '@/systems/scene/types';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { emitItemAdd } from '@/systems/scene/sceneSync';
import { useSessionStore } from '@/store/sessionStore';
import { useMapStore } from '@/systems/map/store/mapStore';
import { useFirstPersonStore } from './firstPersonStore';
import { raycastFpSurface, type FpSurfaceHit, type FpWallHit } from './fpSurfaceRaycast';
import { circleSurfPolygon } from './wallCutMath';
import { pushFpDecalUndo } from './fpPaintUndo';
import type * as THREE from 'three';

export type FpPaintPreview = {
  shape: 'freehand' | 'circle';
  surface: 'floor' | 'wall';
  mapId: string;
  color: string;
  stroke: number;
  /** Floor: world [x,z,...]. Wall: world [x,y,z,...] for live ribbon. */
  worldPts: number[];
  wallA?: { x: number; y: number };
  wallB?: { x: number; y: number };
  wallIndex?: number;
  /** Floor: map-local / world-local. Wall: [along, height,...]. */
  surfacePts: number[];
  centerAlong?: number;
  centerHeight?: number;
  /** Floor circle center world xz + y. */
  centerWorld?: { x: number; y: number; z: number };
  radius?: number;
  nx?: number;
  nz?: number;
};

let painting = false;
let preview: FpPaintPreview | null = null;
let lastSampleAt = 0;
const SAMPLE_MS = 24;
const MIN_DIST = 2.2;

const listeners = new Set<() => void>();

export function getFpPaintPreview(): FpPaintPreview | null {
  return preview;
}

export function subscribeFpPaintPreview(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function notify() {
  for (const cb of listeners) cb();
}

function appendFreehand(hit: FpSurfaceHit) {
  if (!preview || !preview.mapId) return;
  if (preview.surface !== hit.surface || preview.mapId !== hit.mapId) return;

  if (hit.surface === 'floor') {
    const pts = preview.worldPts;
    const n = pts.length;
    if (n >= 2) {
      const dx = hit.worldX - pts[n - 2]!;
      const dz = hit.worldZ - pts[n - 1]!;
      if (Math.hypot(dx, dz) < MIN_DIST) return;
    }
    pts.push(hit.worldX, hit.worldZ);
    preview.surfacePts.push(hit.localX, hit.localY);
  } else {
    if (preview.wallA) {
      const same =
        Math.abs(preview.wallA.x - hit.wallA.x) < 0.5
        && Math.abs(preview.wallA.y - hit.wallA.y) < 0.5
        && Math.abs((preview.wallB?.x ?? 0) - hit.wallB.x) < 0.5
        && Math.abs((preview.wallB?.y ?? 0) - hit.wallB.y) < 0.5;
      if (!same) return;
    }
    const pts = preview.worldPts;
    const n = pts.length;
    if (n >= 3) {
      const dx = hit.worldX - pts[n - 3]!;
      const dy = hit.worldY - pts[n - 2]!;
      const dz = hit.worldZ - pts[n - 1]!;
      if (Math.hypot(dx, dy, dz) < MIN_DIST) return;
    }
    pts.push(hit.worldX, hit.worldY, hit.worldZ);
    preview.surfacePts.push(hit.along, hit.height);
    preview.wallA = { ...hit.wallA };
    preview.wallB = { ...hit.wallB };
    preview.wallIndex = hit.wallIndex;
  }
  notify();
}

function setWallCircle(hit: FpWallHit, cAlong: number, cH: number, radius: number) {
  if (!preview) return;
  const map = useItemStore.getState().items[preview.mapId];
  const mapX = map && map.type === 'map' ? map.x : 0;
  const mapY = map && map.type === 'map' ? map.y : 0;
  const dx = hit.wallB.x - hit.wallA.x;
  const dy = hit.wallB.y - hit.wallA.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  // Match the live hit's face offset so the ghost aligns with the crosshair.
  const midHitX = mapX + hit.wallA.x + ux * hit.along;
  const midHitZ = mapY + hit.wallA.y + uy * hit.along;
  const faceOx = hit.worldX - midHitX;
  const faceOz = hit.worldZ - midHitZ;
  const poly = circleSurfPolygon(cAlong, cH, radius, 40);
  const worldPts: number[] = [];
  const surfacePts: number[] = [];
  for (const p of poly) {
    surfacePts.push(p.along, p.height);
    worldPts.push(
      mapX + hit.wallA.x + ux * p.along + faceOx,
      p.height,
      mapY + hit.wallA.y + uy * p.along + faceOz,
    );
  }
  if (poly[0]) {
    worldPts.push(
      mapX + hit.wallA.x + ux * poly[0].along + faceOx,
      poly[0].height,
      mapY + hit.wallA.y + uy * poly[0].along + faceOz,
    );
  }
  preview.surfacePts = surfacePts;
  preview.worldPts = worldPts;
  preview.centerAlong = cAlong;
  preview.centerHeight = cH;
  preview.radius = radius;
  preview.centerWorld = {
    x: mapX + hit.wallA.x + ux * cAlong + faceOx,
    y: cH,
    z: mapY + hit.wallA.y + uy * cAlong + faceOz,
  };
  preview.nx = hit.nx;
  preview.nz = hit.nz;
  preview.wallA = { ...hit.wallA };
  preview.wallB = { ...hit.wallB };
  preview.wallIndex = hit.wallIndex;
  notify();
}

function setFloorCircle(hit: Extract<FpSurfaceHit, { surface: 'floor' }>, cx: number, cz: number, radius: number) {
  if (!preview) return;
  const worldPts: number[] = [];
  const surfacePts: number[] = [];
  const segs = 40;
  for (let i = 0; i <= segs; i++) {
    const t = (i / segs) * Math.PI * 2;
    const x = cx + Math.cos(t) * radius;
    const z = cz + Math.sin(t) * radius;
    worldPts.push(x, z);
    surfacePts.push(x, z);
  }
  preview.worldPts = worldPts;
  preview.surfacePts = surfacePts;
  preview.radius = radius;
  preview.centerWorld = { x: cx, y: 0.14, z: cz };
  notify();
}

export function beginFpSpray(scene: THREE.Scene | null): void {
  if (painting) return;
  if (useFirstPersonStore.getState().tool !== 'spray') return;

  const { drawColor, drawStroke } = useMapStore.getState();
  const brush = useFirstPersonStore.getState().brushSize;
  const shape = useFirstPersonStore.getState().drawShape;
  painting = true;
  lastSampleAt = 0;
  preview = {
    shape,
    surface: 'floor',
    mapId: '',
    color: drawColor,
    stroke: Math.max(drawStroke, brush),
    worldPts: [],
    surfacePts: [],
  };
  notify();
  const hit = raycastFpSurface(scene);
  if (hit) lockAndAppend(hit);
}

function lockAndAppend(hit: FpSurfaceHit) {
  if (!preview) return;
  if (!preview.mapId) {
    preview.surface = hit.surface;
    preview.mapId = hit.mapId;
    if (hit.surface === 'wall') {
      preview.wallA = { ...hit.wallA };
      preview.wallB = { ...hit.wallB };
      preview.wallIndex = hit.wallIndex;
      preview.nx = hit.nx;
      preview.nz = hit.nz;
    }
    if (preview.shape === 'circle') {
      if (hit.surface === 'wall') {
        setWallCircle(hit, hit.along, hit.height, Math.max(8, preview.stroke * 1.25));
      } else {
        setFloorCircle(hit, hit.worldX, hit.worldZ, Math.max(8, preview.stroke * 1.25));
      }
      return;
    }
  }

  if (preview.shape === 'circle') {
    if (hit.surface === 'wall' && preview.surface === 'wall') {
      const cAlong = preview.centerAlong ?? hit.along;
      const cH = preview.centerHeight ?? hit.height;
      const radius = Math.max(6, Math.hypot(hit.along - cAlong, hit.height - cH));
      setWallCircle(hit, cAlong, cH, radius);
    } else if (hit.surface === 'floor' && preview.surface === 'floor' && preview.centerWorld) {
      const radius = Math.max(6, Math.hypot(hit.worldX - preview.centerWorld.x, hit.worldZ - preview.centerWorld.z));
      setFloorCircle(hit, preview.centerWorld.x, preview.centerWorld.z, radius);
    }
    return;
  }

  appendFreehand(hit);
}

export function sampleFpSpray(scene: THREE.Scene | null): void {
  if (!painting || !preview) return;
  const now = performance.now();
  if (now - lastSampleAt < SAMPLE_MS && preview.mapId) return;
  lastSampleAt = now;
  const hit = raycastFpSurface(scene);
  if (!hit) return;
  lockAndAppend(hit);
}

export function endFpSpray(): void {
  if (!painting) return;
  painting = false;
  const stroke = preview;
  preview = null;
  notify();
  if (!stroke || !stroke.mapId || stroke.surfacePts.length < 4) return;
  commitStroke(stroke);
}

function commitStroke(stroke: FpPaintPreview): void {
  const myUserId = useSessionStore.getState().myUserId;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  if (stroke.surface === 'floor') {
    for (let i = 0; i < stroke.worldPts.length; i += 2) {
      const wx = stroke.worldPts[i]!;
      const wy = stroke.worldPts[i + 1]!;
      minX = Math.min(minX, wx);
      maxX = Math.max(maxX, wx);
      minY = Math.min(minY, wy);
      maxY = Math.max(maxY, wy);
    }
  } else {
    for (let i = 0; i < stroke.worldPts.length; i += 3) {
      const wx = stroke.worldPts[i]!;
      const wz = stroke.worldPts[i + 2]!;
      minX = Math.min(minX, wx);
      maxX = Math.max(maxX, wx);
      minY = Math.min(minY, wz);
      maxY = Math.max(maxY, wz);
    }
  }

  const pad = stroke.stroke;
  minX -= pad;
  minY -= pad;
  maxX += pad;
  maxY += pad;

  let points: number[];
  if (stroke.surface === 'floor') {
    points = [];
    for (let i = 0; i < stroke.worldPts.length; i += 2) {
      points.push(stroke.worldPts[i]! - minX, stroke.worldPts[i + 1]! - minY);
    }
  } else {
    points = [...stroke.surfacePts];
  }

  const item: SurfaceDecalItem = {
    id: uuidv4(),
    type: 'surfaceDecal',
    x: minX,
    y: minY,
    rotation: 0,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
    zIndex: 0,
    locked: false,
    visible: true,
    surface: stroke.surface,
    mapId: stroke.mapId,
    color: stroke.color,
    stroke: stroke.stroke,
    points,
    ...(myUserId ? { ownerId: myUserId } : {}),
  };

  if (stroke.surface === 'wall') {
    if (typeof stroke.wallIndex === 'number') item.wallIndex = stroke.wallIndex;
    if (stroke.wallA) item.wallA = stroke.wallA;
    if (stroke.wallB) item.wallB = stroke.wallB;
  }

  useItemStore.getState().addItem(item);
  emitItemAdd(item);
  pushFpDecalUndo(item.id);
}

export function isFpSprayPainting(): boolean {
  return painting;
}

export function cancelFpSpray(): void {
  painting = false;
  preview = null;
  notify();
}
