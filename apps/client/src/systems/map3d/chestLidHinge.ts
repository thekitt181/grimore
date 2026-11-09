import * as THREE from 'three';

const LID_NAME = 'chest_lid';
const LOOT_NAME = 'chest_loot';
const _upLocal = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _n = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

function alreadyHinged(root: THREE.Object3D): boolean {
  let found = false;
  root.traverse((obj) => {
    const n = obj.name.toLowerCase();
    if (n.includes('lid') || n.endsWith('_top') || n.endsWith('_cover')) found = true;
  });
  return found;
}

/** World +Y expressed in this mesh's local space (handles Blender Z-up node quats). */
function upInMeshLocal(mesh: THREE.Object3D): THREE.Vector3 {
  mesh.updateMatrix();
  mesh.getWorldQuaternion(_q);
  _upLocal.set(0, 1, 0).applyQuaternion(_q.invert()).normalize();
  if (_upLocal.lengthSq() < 1e-8) _upLocal.set(0, 1, 0);
  return _upLocal;
}

function heightOf(pos: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, i: number, up: THREE.Vector3): number {
  return pos.getX(i) * up.x + pos.getY(i) * up.y + pos.getZ(i) * up.z;
}

function triNormalDotUp(
  pos: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  i0: number,
  up: THREE.Vector3,
): number {
  _a.set(pos.getX(i0 + 1) - pos.getX(i0), pos.getY(i0 + 1) - pos.getY(i0), pos.getZ(i0 + 1) - pos.getZ(i0));
  _b.set(pos.getX(i0 + 2) - pos.getX(i0), pos.getY(i0 + 2) - pos.getY(i0), pos.getZ(i0 + 2) - pos.getZ(i0));
  _n.copy(_a).cross(_b);
  const len = _n.length() || 1;
  return (_n.x * up.x + _n.y * up.y + _n.z * up.z) / len;
}

function copyTriangles(src: THREE.BufferGeometry, tris: number[]): THREE.BufferGeometry {
  const dst = new THREE.BufferGeometry();
  const vCount = tris.length * 3;
  for (const name of Object.keys(src.attributes)) {
    const attr = src.getAttribute(name);
    const itemSize = attr.itemSize;
    const next = new Float32Array(vCount * itemSize);
    let o = 0;
    for (const t of tris) {
      for (let v = 0; v < 3; v++) {
        const i = t * 3 + v;
        next[o++] = attr.getX(i);
        if (itemSize > 1) next[o++] = attr.getY(i);
        if (itemSize > 2) next[o++] = attr.getZ(i);
        if (itemSize > 3) next[o++] = attr.getW(i);
      }
    }
    dst.setAttribute(name, new THREE.BufferAttribute(next, itemSize, attr.normalized));
  }
  return dst;
}

function splitLid(
  geo: THREE.BufferGeometry,
  splitH: number,
  up: THREE.Vector3,
): { lid: THREE.BufferGeometry; body: THREE.BufferGeometry } | null {
  const pos = geo.getAttribute('position');
  if (!pos || pos.count < 9) return null;
  const triCount = Math.floor(pos.count / 3);
  const lidTris: number[] = [];
  const bodyTris: number[] = [];
  for (let t = 0; t < triCount; t++) {
    const i = t * 3;
    const h0 = heightOf(pos, i, up);
    const h1 = heightOf(pos, i + 1, up);
    const h2 = heightOf(pos, i + 2, up);
    const hmin = Math.min(h0, h1, h2);
    const havg = (h0 + h1 + h2) / 3;
    const facingUp = triNormalDotUp(pos, i, up) > 0.35;
    const isLid = hmin >= splitH || (havg >= splitH && facingUp);
    (isLid ? lidTris : bodyTris).push(t);
  }
  const lidShare = lidTris.length / triCount;
  if (lidTris.length < 24 || bodyTris.length < 24 || lidShare < 0.02 || lidShare > 0.4) {
    return null;
  }
  return { lid: copyTriangles(geo, lidTris), body: copyTriangles(geo, bodyTris) };
}

function pickSeamAndSplit(
  geo: THREE.BufferGeometry,
  up: THREE.Vector3,
): { lid: THREE.BufferGeometry; body: THREE.BufferGeometry; split: number } | null {
  const pos = geo.getAttribute('position');
  let minH = Infinity;
  let maxH = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const h = heightOf(pos, i, up);
    if (h < minH) minH = h;
    if (h > maxH) maxH = h;
  }
  const span = maxH - minH;
  if (!(span > 1e-8)) return null;
  for (const f of [0.88, 0.84, 0.8, 0.76, 0.72]) {
    const split = minH + f * span;
    const parts = splitLid(geo, split, up);
    if (parts) return { ...parts, split };
  }
  return null;
}

function dominantAxis(v: THREE.Vector3): 'x' | 'y' | 'z' {
  const ax = Math.abs(v.x);
  const ay = Math.abs(v.y);
  const az = Math.abs(v.z);
  if (ax >= ay && ax >= az) return 'x';
  if (ay >= az) return 'y';
  return 'z';
}

function interiorMaterial(mesh: THREE.Mesh): THREE.MeshStandardMaterial {
  const src = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  const mat = new THREE.MeshStandardMaterial({
    color: '#5a3d24',
    roughness: 0.86,
    metalness: 0.06,
    emissive: '#2a1810',
    emissiveIntensity: 0.22,
    side: THREE.FrontSide,
  });
  if (src instanceof THREE.MeshStandardMaterial) {
    mat.color.copy(src.color).lerp(new THREE.Color('#4a3018'), 0.65);
    mat.color.multiplyScalar(0.55);
  }
  return mat;
}

function addOpenBox(
  parent: THREE.Object3D,
  cx: number,
  cy: number,
  cz: number,
  width: number,
  depthXz: number,
  up: THREE.Vector3,
  depth: number,
  mat: THREE.Material,
): THREE.BufferGeometry[] {
  const geos: THREE.BufferGeometry[] = [];
  const floor = new THREE.PlaneGeometry(width, depthXz);
  const floorMesh = new THREE.Mesh(floor, mat);
  const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), up.clone().normalize());
  floorMesh.quaternion.copy(quat);
  floorMesh.position.set(cx - up.x * depth, cy - up.y * depth, cz - up.z * depth);
  floorMesh.receiveShadow = true;
  parent.add(floorMesh);
  geos.push(floor);
  return geos;
}

/**
 * Spajx chests are a single mesh with a Z-up node rotation and no lid bone.
 * Peel the world-up roof, hinge at the back of that lid, wood cavity + loot.
 */
export function attachSyntheticChestLid(root: THREE.Object3D): void {
  if (root.userData.syntheticChestLid || alreadyHinged(root)) return;
  root.userData.syntheticChestLid = true;
  root.updateMatrixWorld(true);
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];

  const meshes: THREE.Mesh[] = [];
  root.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) meshes.push(obj as THREE.Mesh);
  });

  for (const mesh of meshes) {
    const up = upInMeshLocal(mesh).clone();
    const src = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    if (mesh.geometry.index) geos.push(src);
    const picked = pickSeamAndSplit(src, up);
    if (!picked) {
      if (src !== mesh.geometry) src.dispose();
      continue;
    }
    const { lid, body, split } = picked;
    body.computeBoundingBox();
    lid.computeBoundingBox();
    const lidBox = lid.boundingBox ?? new THREE.Box3();
    const bodyBox = body.boundingBox ?? new THREE.Box3();

    const size = lidBox.getSize(new THREE.Vector3());
    // Horizontal axes = the two that aren't "up".
    const upAxis = dominantAxis(up);
    const horiz: Array<'x' | 'y' | 'z'> = (['x', 'y', 'z'] as const).filter((a) => a !== upAxis);
    const len0 = size[horiz[0]!];
    const len1 = size[horiz[1]!];
    const hingeAxis = len0 >= len1 ? horiz[0]! : horiz[1]!;
    const across = hingeAxis === horiz[0]! ? horiz[1]! : horiz[0]!;

    const posBody = body.getAttribute('position');
    let minHBody = Infinity;
    let maxHBody = -Infinity;
    for (let i = 0; i < posBody.count; i++) {
      const h = heightOf(posBody, i, up);
      if (h < minHBody) minHBody = h;
      if (h > maxHBody) maxHBody = h;
    }
    // Pack is authored lock-forward. World -Z is the back after the Z-up node quat.
    mesh.updateWorldMatrix(true, false);
    const localBack = new THREE.Vector3(0, 0, -1).transformDirection(
      new THREE.Matrix4().copy(mesh.matrixWorld).invert(),
    );
    const back = localBack[across] >= 0 ? lidBox.max[across] : lidBox.min[across];

    const hingePos = new THREE.Vector3(
      (lidBox.min.x + lidBox.max.x) * 0.5,
      (lidBox.min.y + lidBox.max.y) * 0.5,
      (lidBox.min.z + lidBox.max.z) * 0.5,
    );
    hingePos[across] = back;
    // Sit the hinge on the seam along up.
    const hingeH = split;
    const curH = hingePos.dot(up);
    hingePos.addScaledVector(up, hingeH - curH);

    lid.translate(-hingePos.x, -hingePos.y, -hingePos.z);
    mesh.geometry = body;
    geos.push(body, lid);

    const hinge = new THREE.Group();
    hinge.name = LID_NAME;
    hinge.position.copy(hingePos);
    const lidCentroid = new THREE.Vector3(
      (lidBox.min.x + lidBox.max.x) * 0.5 - hingePos.x,
      (lidBox.min.y + lidBox.max.y) * 0.5 - hingePos.y,
      (lidBox.min.z + lidBox.max.z) * 0.5 - hingePos.z,
    );
    const axisVec = new THREE.Vector3(
      hingeAxis === 'x' ? 1 : 0,
      hingeAxis === 'y' ? 1 : 0,
      hingeAxis === 'z' ? 1 : 0,
    );
    const lift = new THREE.Vector3().copy(axisVec).cross(lidCentroid);
    const openSign = lift.dot(up) >= 0 ? 1 : -1;
    hinge.userData.lidAxis = hingeAxis;
    hinge.userData.lidSign = openSign;
    hinge.userData.lidOpenRad = 1.15;

    const lidMesh = new THREE.Mesh(lid, mesh.material);
    lidMesh.castShadow = mesh.castShadow;
    lidMesh.receiveShadow = mesh.receiveShadow;
    lidMesh.frustumCulled = false;
    const innerMat = interiorMaterial(mesh);
    const lidUnderMat = innerMat.clone();
    lidUnderMat.side = THREE.BackSide;
    mats.push(innerMat, lidUnderMat);
    lidMesh.add(new THREE.Mesh(lid, lidUnderMat));
    mesh.add(hinge);
    hinge.add(lidMesh);

    const c = bodyBox.getCenter(new THREE.Vector3());
    const half = bodyBox.getSize(new THREE.Vector3()).multiplyScalar(0.36);
    const depth = Math.max(0.03, (split - minHBody) * 0.42);
    geos.push(
      ...addOpenBox(
        mesh,
        c.x,
        c.y,
        c.z,
        Math.max(half.x, half.y) * 2,
        Math.max(half.z, half.y) * 2,
        up,
        depth,
        innerMat,
      ),
    );

    const lootGeo = new THREE.SphereGeometry(Math.min(half.x, half.z) * 0.22, 10, 8);
    const lootMat = new THREE.MeshStandardMaterial({
      color: '#e2c05a',
      metalness: 0.78,
      roughness: 0.28,
      emissive: '#c9a84c',
      emissiveIntensity: 0.55,
    });
    const loot = new THREE.Group();
    loot.name = LOOT_NAME;
    loot.visible = false;
    const offsets: Array<[number, number]> = [[0, 0], [0.35, 0.2], [-0.3, 0.15], [0.12, -0.28]];
    for (const [ox, oz] of offsets) {
      const coin = new THREE.Mesh(lootGeo, lootMat);
      coin.scale.set(1, 0.38, 1);
      coin.position.copy(c).addScaledVector(up, -depth * 0.55);
      coin.position.x += ox * half.x;
      coin.position.z += oz * half.z;
      coin.castShadow = true;
      loot.add(coin);
    }
    mesh.add(loot);
    geos.push(lootGeo);
    mats.push(lootMat);
  }

  root.userData.syntheticChestLidGeos = geos;
  root.userData.syntheticChestLidMats = mats;
}

const hingedTemplates = new Map<string, THREE.Object3D>();

/** Split once per GLB, then instance. Stacked copies share lid/body geometry. */
export function cloneHingedChestRoot(source: THREE.Object3D, cacheKey: string): THREE.Object3D {
  let tmpl = hingedTemplates.get(cacheKey);
  if (!tmpl) {
    tmpl = source.clone(true);
    attachSyntheticChestLid(tmpl);
    hingedTemplates.set(cacheKey, tmpl);
  }
  const inst = tmpl.clone(true);
  inst.userData.syntheticChestLidShared = true;
  inst.userData.syntheticChestLid = true;
  return inst;
}

export function disposeSyntheticChestLid(root: THREE.Object3D): void {
  if (root.userData.syntheticChestLidShared) return;
  const geos = root.userData.syntheticChestLidGeos as THREE.BufferGeometry[] | undefined;
  const mats = root.userData.syntheticChestLidMats as THREE.Material[] | undefined;
  geos?.forEach((g) => g.dispose());
  mats?.forEach((m) => m.dispose());
  root.userData.syntheticChestLidGeos = undefined;
  root.userData.syntheticChestLidMats = undefined;
}
