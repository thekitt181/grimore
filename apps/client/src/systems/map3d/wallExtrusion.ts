import * as THREE from 'three';
import type { WallCut, WallSegment } from '@/systems/scene/types';
import { cutHolePolygon, cutsForSegment } from './wallCutMath';

export type ExtrudedWall = {
  key: string;
  position: [number, number, number];
  size: [number, number, number];
  rotationY: number;
  /** Present when the wall has freehand breach holes — use instead of boxGeometry. */
  geometry?: THREE.BufferGeometry;
  wallIndex: number;
  ax: number;
  ay: number;
  bx: number;
  by: number;
};

/** Build a wall slab; optional freehand holes from WallCut shapes. */
function buildWallGeometry(
  length: number,
  height: number,
  thickness: number,
  cuts: WallCut[],
): THREE.BufferGeometry {
  if (cuts.length === 0) {
    return new THREE.BoxGeometry(thickness, height, length);
  }

  const shape = new THREE.Shape();
  // Shape in (along=X, height=Y); extrude along +Z then reorient.
  shape.moveTo(0, 0);
  shape.lineTo(length, 0);
  shape.lineTo(length, height);
  shape.lineTo(0, height);
  shape.closePath();

  for (const cut of cuts) {
    const poly = cutHolePolygon(cut);
    if (poly.length < 3) continue;
    const hole = new THREE.Path();
    const p0 = poly[0]!;
    hole.moveTo(
      Math.max(0.01, Math.min(length - 0.01, p0.along)),
      Math.max(0.01, Math.min(height - 0.01, p0.height)),
    );
    for (let i = 1; i < poly.length; i++) {
      const p = poly[i]!;
      hole.lineTo(
        Math.max(0.01, Math.min(length - 0.01, p.along)),
        Math.max(0.01, Math.min(height - 0.01, p.height)),
      );
    }
    hole.closePath();
    shape.holes.push(hole);
  }

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
    curveSegments: 24,
    steps: 1,
  });
  // ExtrudeGeometry: x=along, y=height, z=0..thickness → BoxGeometry(thickness, height, length).
  // rotateY(-90°): (x,y,z)→(−z,y,x) so Z aligns with along (A→B).
  geo.translate(-length / 2, -height / 2, -thickness / 2);
  geo.rotateY(-Math.PI / 2);
  // Match BoxGeometry face UVs so tiled brick/wood textures keep repeating on the remaining wall.
  applyWallSlabUVs(geo, length, height);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Project UVs onto the wall face (along × height) like a box side, so
 * `tileSurfaceTexture(..., length, height)` looks the same with/without holes.
 */
function applyWallSlabUVs(geo: THREE.BufferGeometry, length: number, height: number): void {
  const pos = geo.getAttribute('position');
  if (!pos) return;
  const uvs = new Float32Array(pos.count * 2);
  const len = Math.max(1e-3, length);
  const h = Math.max(1e-3, height);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const z = pos.getZ(i);
    // Local box space after transform: Z = along, Y = up.
    uvs[i * 2] = (z / len) + 0.5;
    uvs[i * 2 + 1] = (y / h) + 0.5;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
}

/** Build axis-aligned box transforms for wall segments (map-local → world). */
export function extrudeWallSegments(
  walls: WallSegment[],
  mapX: number,
  mapY: number,
  height: number,
  thickness: number,
  wallCuts: WallCut[] = [],
): ExtrudedWall[] {
  const out: ExtrudedWall[] = [];

  for (let i = 0; i < walls.length; i++) {
    const seg = walls[i];
    if (!seg) continue;

    const ax = mapX + seg.a.x;
    const az = mapY + seg.a.y;
    const bx = mapX + seg.b.x;
    const bz = mapY + seg.b.y;
    const dx = bx - ax;
    const dz = bz - az;
    const length = Math.hypot(dx, dz);
    if (length < 2) continue;

    const segCuts = wallCuts.length ? cutsForSegment(seg, wallCuts) : [];
    const geometry = segCuts.length > 0
      ? buildWallGeometry(length, height, thickness, segCuts)
      : undefined;

    out.push({
      key: `${i}-${ax.toFixed(1)}-${az.toFixed(1)}-${segCuts.map((c) => c.id).join('.')}`,
      position: [(ax + bx) / 2, height / 2, (az + bz) / 2],
      size: [thickness, height, length],
      rotationY: Math.atan2(dx, dz),
      ...(geometry ? { geometry } : {}),
      wallIndex: i,
      ax: seg.a.x,
      ay: seg.a.y,
      bx: seg.b.x,
      by: seg.b.y,
    });
  }

  return out;
}
