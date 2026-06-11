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
