/** Pixi world (x right, y down) → Three.js (Y up, ground on XZ). */
export function pixiToThreeX(x: number): number {
  return x;
}

export function pixiToThreeZ(y: number): number {
  return y;
}

export function itemCenterXZ(item: { x: number; y: number; width: number; height: number }): [number, number] {
  return [item.x + item.width / 2, item.y + item.height / 2];
}

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Screen drag → ground-plane (cx, cz) delta for 3D orbit view (matches 2D pan at azimuth 0). */
export function screenPanToGroundDelta(
  screenDx: number,
  screenDy: number,
  azimuth: number,
  scale: number,
): { dcx: number; dcz: number } {
  const panX = -screenDx / scale;
  const panZ = -screenDy / scale;
  const cosA = Math.cos(azimuth);
  const sinA = Math.sin(azimuth);
  return {
    dcx: panX * cosA - panZ * sinA,
    dcz: panX * sinA + panZ * cosA,
  };
}
