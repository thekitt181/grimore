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

function pentagonalBipyramid(radius: number, height: number): THREE.BufferGeometry {
  const top = new THREE.Vector3(0, height, 0);
  const bottom = new THREE.Vector3(0, -height, 0);
  const ring: THREE.Vector3[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
    ring.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
  }

  const vertices: number[] = [];
  const push = (v: THREE.Vector3) => vertices.push(v.x, v.y, v.z);
  push(top);
  ring.forEach(push);
  push(bottom);

  const indices: number[] = [];
  for (let i = 0; i < 5; i++) {
    const a = 1 + i;
    const b = 1 + ((i + 1) % 5);
    indices.push(0, a, b);
    indices.push(6, b, a);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

const geometryCache = new Map<number, THREE.BufferGeometry>();

/** RPG die mesh matching face count (d4–d20, d100 → d10). */
export function createDieGeometry(sides: number): THREE.BufferGeometry {
  const kind = normalizeDieSides(sides);
  const cached = geometryCache.get(kind);
  if (cached) return cached;

  let geo: THREE.BufferGeometry;
  switch (kind) {
    case 4:
      geo = new THREE.TetrahedronGeometry(0.52, 0);
      break;
    case 6:
      geo = new THREE.BoxGeometry(0.72, 0.72, 0.72, 2, 2, 2);
      break;
    case 8:
      geo = new THREE.OctahedronGeometry(0.56, 0);
      break;
    case 10:
      geo = pentagonalBipyramid(0.48, 0.42);
      break;
    case 12:
      geo = new THREE.DodecahedronGeometry(0.5, 0);
      break;
    case 20:
      geo = new THREE.IcosahedronGeometry(0.52, 0);
      break;
    default:
      geo = new THREE.IcosahedronGeometry(0.52, 0);
  }

  geometryCache.set(kind, geo);
  return geo;
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
