import * as THREE from 'three';

/** Map percentile / odd notations to the physical die shape used in 3D. */
export function normalizeDieSides(sides: number): 4 | 6 | 8 | 10 | 12 | 20 {
  if (sides === 100) return 10;
  if (sides === 4 || sides === 6 || sides === 8 || sides === 10 || sides === 12 || sides === 20) {
    return sides;
  }
  if (sides <= 4) return 4;
  if (sides <= 6) return 6;
  if (sides <= 8) return 8;
  if (sides <= 10) return 10;
  if (sides <= 12) return 12;
  return 20;
}

/**
 * Proper d10 shape: a pentagonal trapezohedron with 10 kite faces and the two
 * apexes offset by 36°. The apex height is derived from `d` so every kite is
 * mathematically planar (`c = d·(1+cos36°)/(1−cos36°)`), which keeps each kite a
 * single flat face when triangles are grouped by normal.
 */
function pentagonalTrapezohedron(r: number, d: number): THREE.BufferGeometry {
  const cos36 = Math.cos(Math.PI / 5);
  const c = (d * (1 + cos36)) / (1 - cos36);
  const N = new THREE.Vector3(0, c, 0);
  const S = new THREE.Vector3(0, -c, 0);

  // 10 equatorial vertices, zig-zagging: even index dips down (−d), odd lifts up (+d).
  const E: THREE.Vector3[] = [];
  for (let m = 0; m < 10; m += 1) {
    const a = (Math.PI * 2 * m) / 10;
    const y = m % 2 === 0 ? -d : d;
    E.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
  }

  const pos: number[] = [];
  const addTri = (a: THREE.Vector3, b: THREE.Vector3, cc: THREE.Vector3): void => {
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z, cc.x, cc.y, cc.z);
  };
  const addKite = (
    apex: THREE.Vector3,
    p1: THREE.Vector3,
    far: THREE.Vector3,
    p3: THREE.Vector3,
  ): void => {
    // Split the kite into two coplanar triangles, wound so the normal faces out.
    const center = apex.clone().add(p1).add(far).add(p3).multiplyScalar(0.25);
    const nrm = new THREE.Vector3()
      .subVectors(p1, apex)
      .cross(new THREE.Vector3().subVectors(far, apex));
    if (nrm.dot(center) < 0) {
      addTri(apex, far, p1);
      addTri(apex, p3, far);
    } else {
      addTri(apex, p1, far);
      addTri(apex, far, p3);
    }
  };

  // Top kites: far (central) vertex is a down vertex (even m); sides are the two
  // adjacent up vertices. Bottom kites mirror this around an up vertex (odd m).
  for (let m = 0; m < 10; m += 2) {
    addKite(N, E[(m + 1) % 10]!, E[m]!, E[(m + 9) % 10]!);
  }
  for (let m = 1; m < 10; m += 2) {
    addKite(S, E[(m + 1) % 10]!, E[m]!, E[(m + 9) % 10]!);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Replace a geometry's UVs so each triangle shows the full (centred) texture
 * square. The platonic-solid geometries from three.js use spherical UVs that
 * collapse an imported image to a single texel, so a custom skin would render
 * as a flat colour without this.
 */
function applyFaceTextureUVs(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.getAttribute('position');
  const triCount = Math.floor(pos.count / 3);
  // A triangle inscribed in the unit square, centred so the image's middle
  // (where a die motif usually sits) lands on each face.
  const tri = [0.5, 0.98, 0.02, 0.04, 0.98, 0.04];
  const uv = new Float32Array(pos.count * 2);
  for (let t = 0; t < triCount; t += 1) {
    const o = t * 6;
    for (let k = 0; k < 6; k += 1) uv[o + k] = tri[k]!;
  }
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/** RPG die mesh matching face count (d4–d20, d100 → d10). */
export function createDieGeometry(sides: number): THREE.BufferGeometry {
  const kind = normalizeDieSides(sides);

  let geo: THREE.BufferGeometry;
  switch (kind) {
    case 4:
      geo = applyFaceTextureUVs(new THREE.TetrahedronGeometry(0.52, 0));
      break;
    case 6:
      // Box UVs already map the full image onto each face.
      geo = new THREE.BoxGeometry(0.72, 0.72, 0.72);
      break;
    case 8:
      geo = applyFaceTextureUVs(new THREE.OctahedronGeometry(0.56, 0));
      break;
    case 10:
      geo = applyFaceTextureUVs(pentagonalTrapezohedron(0.5, 0.0528));
      break;
    case 12:
      geo = applyFaceTextureUVs(new THREE.DodecahedronGeometry(0.5, 0));
      break;
    case 20:
      geo = applyFaceTextureUVs(new THREE.IcosahedronGeometry(0.52, 0));
      break;
    default:
      geo = applyFaceTextureUVs(new THREE.IcosahedronGeometry(0.52, 0));
  }

  return geo;
}

function baseSolid(kind: 4 | 6 | 8 | 10 | 12 | 20): THREE.BufferGeometry {
  switch (kind) {
    case 4:
      return new THREE.TetrahedronGeometry(0.52, 0);
    case 6:
      return new THREE.BoxGeometry(0.72, 0.72, 0.72);
    case 8:
      return new THREE.OctahedronGeometry(0.56, 0);
    case 10:
      return pentagonalTrapezohedron(0.5, 0.0528);
    case 12:
      return new THREE.DodecahedronGeometry(0.5, 0);
    default:
      return new THREE.IcosahedronGeometry(0.52, 0);
  }
}

/** A number drawn inside an atlas cell (cell-normalised coords; v points up). */
export interface DieLabel {
  text: string;
  u: number;
  v: number;
  /** Rotation (radians) so the number reads upright when its face/vertex is up. */
  rot: number;
  /** Glyph size as a fraction of the cell. */
  size: number;
}

export interface NumberedDie {
  geometry: THREE.BufferGeometry;
  faceCount: number;
  cols: number;
  rows: number;
  /** Labels to bake per atlas cell (index = cell). */
  cellLabels: DieLabel[][];
  /** Rotation that shows `value` upright toward the camera. */
  orientFor: (value: number) => THREE.Quaternion;
}

/** Direction a result face/vertex is rotated to point (toward the tray camera). */
const CAMERA_DIR = new THREE.Vector3(0, 0.45, 0.9).normalize();
/** Where a d4's winning vertex points (up, slightly toward camera) for apex read. */
const APEX_DIR = new THREE.Vector3(0, 0.9, 0.42).normalize();

/** Quaternion mapping a face's (u,v,n) basis onto screen (right, up, toCamera). */
function uprightFaceQuat(n: THREE.Vector3, u: THREE.Vector3, v: THREE.Vector3): THREE.Quaternion {
  const f = CAMERA_DIR.clone();
  const worldUp = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(worldUp, f);
  if (right.lengthSq() < 1e-4) right.set(1, 0, 0);
  right.normalize();
  const up = new THREE.Vector3().crossVectors(f, right).normalize();
  const targetM = new THREE.Matrix4().makeBasis(right, up, f);
  const localM = new THREE.Matrix4()
    .makeBasis(u.clone().normalize(), v.clone().normalize(), n.clone().normalize())
    .transpose();
  return new THREE.Quaternion().setFromRotationMatrix(targetM.multiply(localM));
}

/**
 * Standard polyhedral die (d6–d20): one number per face, opposite faces summing to
 * faceCount + 1 (e.g. d6 → 7, d20 → 21), each face planar-projected into an atlas
 * cell. Returns an orient function that shows the rolled value upright at the front.
 */
function buildStandardDie(kind: 4 | 6 | 8 | 10 | 12 | 20): NumberedDie {
  const base = baseSolid(kind);
  const g = base.index ? base.toNonIndexed() : base;
  const pos = g.getAttribute('position');
  const triCount = Math.floor(pos.count / 3);

  const key = (n: THREE.Vector3): string =>
    `${Math.round(n.x * 50)},${Math.round(n.y * 50)},${Math.round(n.z * 50)}`;

  const groups = new Map<string, number[]>();
  const groupNormal = new Map<string, THREE.Vector3>();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  for (let t = 0; t < triCount; t += 1) {
    a.fromBufferAttribute(pos, t * 3);
    b.fromBufferAttribute(pos, t * 3 + 1);
    c.fromBufferAttribute(pos, t * 3 + 2);
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    nrm.crossVectors(ab, ac).normalize();
    const k = key(nrm);
    let arr = groups.get(k);
    if (!arr) {
      arr = [];
      groups.set(k, arr);
      groupNormal.set(k, nrm.clone());
    }
    arr.push(t);
  }

  const faceKeys = Array.from(groups.keys());
  const faceCount = faceKeys.length;
  // Use a square grid (rows === cols) so every atlas cell is square. Otherwise a
  // square-faced die (d6) gets a stretched, distorted texture on its faces.
  const cols = Math.ceil(Math.sqrt(faceCount));
  const rows = cols;
  const normals = faceKeys.map((k) => groupNormal.get(k)!);

  // Assign numbers so opposite faces sum to faceCount + 1.
  const faceNumber = new Array<number>(faceCount).fill(0);
  const used = new Array<boolean>(faceCount).fill(false);
  let pair = 0;
  for (let i = 0; i < faceCount; i += 1) {
    if (used[i]) continue;
    let opp = -1;
    let bestDot = Infinity;
    for (let j = 0; j < faceCount; j += 1) {
      if (j === i || used[j]) continue;
      const d = normals[i]!.dot(normals[j]!);
      if (d < bestDot) {
        bestDot = d;
        opp = j;
      }
    }
    used[i] = true;
    faceNumber[i] = pair + 1;
    if (opp >= 0) {
      used[opp] = true;
      faceNumber[opp] = faceCount - pair;
    }
    pair += 1;
  }

  const uv = new Float32Array(pos.count * 2);
  const faceNormals: THREE.Vector3[] = [];
  const faceU: THREE.Vector3[] = [];
  const faceV: THREE.Vector3[] = [];
  const cellLabels: DieLabel[][] = [];
  const vert = new THREE.Vector3();
  const refUp = new THREE.Vector3();
  const uAxis = new THREE.Vector3();
  const vAxis = new THREE.Vector3();

  faceKeys.forEach((k, faceIdx) => {
    const tris = groups.get(k)!;
    const n = groupNormal.get(k)!;
    faceNormals[faceIdx] = n.clone();

    refUp.set(0, 1, 0);
    if (Math.abs(n.y) > 0.92) refUp.set(1, 0, 0);
    uAxis.crossVectors(refUp, n).normalize();
    vAxis.crossVectors(n, uAxis).normalize();
    faceU[faceIdx] = uAxis.clone();
    faceV[faceIdx] = vAxis.clone();

    const pts: Array<{ o: number; x: number; y: number }> = [];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const t of tris) {
      for (let kk = 0; kk < 3; kk += 1) {
        vert.fromBufferAttribute(pos, t * 3 + kk);
        const px = vert.dot(uAxis);
        const py = vert.dot(vAxis);
        pts.push({ o: (t * 3 + kk) * 2, x: px, y: py });
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
      }
    }

    const spanX = maxX - minX || 1;
    const spanY = maxY - minY || 1;
    const span = Math.max(spanX, spanY);
    const col = faceIdx % cols;
    const row = Math.floor(faceIdx / cols);
    const pad = 0.06;
    let sumX = 0;
    let sumY = 0;
    let uniq = 0;
    const seen = new Set<string>();
    for (const p of pts) {
      const nx = (p.x - minX + (span - spanX) / 2) / span;
      const ny = (p.y - minY + (span - spanY) / 2) / span;
      const cu = (col + pad + nx * (1 - 2 * pad)) / cols;
      const cv = 1 - (row + pad + (1 - ny) * (1 - 2 * pad)) / rows;
      uv[p.o] = cu;
      uv[p.o + 1] = cv;
      const vk = `${Math.round(nx * 1000)},${Math.round(ny * 1000)}`;
      if (!seen.has(vk)) {
        seen.add(vk);
        sumX += nx;
        sumY += ny;
        uniq += 1;
      }
    }

    // Centre the number on the face's centroid (in-cell coords, v up), so it sits
    // visually centred on triangular/kite faces instead of riding high.
    const cx = uniq ? sumX / uniq : 0.5;
    const cy = uniq ? sumY / uniq : 0.5;
    cellLabels[faceIdx] = [
      {
        text: String(faceNumber[faceIdx]),
        u: pad + cx * (1 - 2 * pad),
        v: pad + cy * (1 - 2 * pad),
        rot: 0,
        size: 0.4,
      },
    ];
  });

  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();

  const orientFor = (value: number): THREE.Quaternion => {
    const idx = faceNumber.indexOf(value);
    if (idx < 0) return new THREE.Quaternion();
    return uprightFaceQuat(faceNormals[idx]!, faceU[idx]!, faceV[idx]!);
  };

  return { geometry: g, faceCount, cols, rows, cellLabels, orientFor };
}

/**
 * Traditional d4: numbers live on the vertices and each triangular face shows its
 * three vertex numbers at the corners, each rotated so it reads upright when its
 * vertex is the top apex. The roll is shown by rotating the matching vertex up.
 */
function buildD4(): NumberedDie {
  const base = new THREE.TetrahedronGeometry(0.52, 0);
  const g = base.index ? base.toNonIndexed() : base;
  const pos = g.getAttribute('position');
  const triCount = Math.floor(pos.count / 3);

  const verts: THREE.Vector3[] = [];
  const indexOfVert = (p: THREE.Vector3): number => {
    for (let i = 0; i < verts.length; i += 1) if (verts[i]!.distanceTo(p) < 1e-3) return i;
    verts.push(p.clone());
    return verts.length - 1;
  };
  const faceVerts: number[][] = [];
  const tmp = new THREE.Vector3();
  for (let t = 0; t < triCount; t += 1) {
    const trio: number[] = [];
    for (let kk = 0; kk < 3; kk += 1) {
      tmp.fromBufferAttribute(pos, t * 3 + kk);
      trio.push(indexOfVert(tmp));
    }
    faceVerts.push(trio);
  }

  const vertexNumber = verts.map((_, i) => i + 1);
  const vertexDir = verts.map((v) => v.clone().normalize());

  const faceCount = 4;
  const cols = 2;
  const rows = 2;
  // Cell corners (v up), CCW to match the outward triangle winding: apex, lower-left, lower-right.
  const cornerUV = [
    { u: 0.5, v: 0.84 },
    { u: 0.15, v: 0.2 },
    { u: 0.85, v: 0.2 },
  ];
  const centroid = { u: 0.5, v: (0.84 + 0.2 + 0.2) / 3 };

  const uv = new Float32Array(pos.count * 2);
  const cellLabels: DieLabel[][] = [];

  for (let t = 0; t < triCount; t += 1) {
    const col = t % cols;
    const row = Math.floor(t / cols);
    const labels: DieLabel[] = [];
    for (let cIdx = 0; cIdx < 3; cIdx += 1) {
      const corner = cornerUV[cIdx]!;
      const o = (t * 3 + cIdx) * 2;
      uv[o] = (col + corner.u) / cols;
      uv[o + 1] = 1 - (row + (1 - corner.v)) / rows;

      const dirU = corner.u - centroid.u;
      const dirV = corner.v - centroid.v;
      labels.push({
        text: String(vertexNumber[faceVerts[t]![cIdx]!]),
        u: corner.u * 0.58 + centroid.u * 0.42,
        v: corner.v * 0.58 + centroid.v * 0.42,
        rot: Math.atan2(dirU, dirV),
        size: 0.24,
      });
    }
    cellLabels.push(labels);
  }

  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();

  const orientFor = (value: number): THREE.Quaternion => {
    const idx = vertexNumber.indexOf(value);
    const q = new THREE.Quaternion();
    if (idx < 0) return q;
    return q.setFromUnitVectors(vertexDir[idx]!.clone(), APEX_DIR);
  };

  return { geometry: g, faceCount, cols, rows, cellLabels, orientFor };
}

/**
 * Build a procedurally-numbered die: a real shape with standard number placement.
 * The uploaded image only supplies colours/pattern; numbers are reconstructed here.
 */
export function buildNumberedDie(sides: number): NumberedDie {
  const kind = normalizeDieSides(sides);
  return kind === 4 ? buildD4() : buildStandardDie(kind);
}

export function dieColor(sides: number): string {
  const kind = normalizeDieSides(sides);
  switch (kind) {
    case 20: return '#8b1a1a';
    case 12: return '#1a3a8b';
    case 10: return '#2d6a4f';
    case 8: return '#6b21a8';
    case 6: return '#374151';
    case 4: return '#92400e';
    default: return '#4b5563';
  }
}
