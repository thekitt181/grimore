import type { TokenItem } from '@/systems/scene/types';
import { itemCenter } from '@/systems/scene/types';

export const FEET_PER_CELL = 5;
export const LINE_AOE_WIDTH_FT = 5;

export interface AoePlacement {
  originX: number;
  originY: number;
  angleRad: number;
  centerX: number;
  centerY: number;
}

export function feetToPixels(feet: number, gridSize: number): number {
  return (feet / FEET_PER_CELL) * gridSize;
}

export function isDirectedAoe(type: string): boolean {
  const t = type.toLowerCase();
  return t === 'line' || t === 'cone';
}

export function angleBetween(ox: number, oy: number, tx: number, ty: number): number {
  return Math.atan2(ty - oy, tx - ox);
}

export function pointInPolygon(px: number, py: number, poly: { x: number; y: number }[]): boolean {
  if (poly.length < 3) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i]!.x;
    const yi = poly[i]!.y;
    const xj = poly[j]!.x;
    const yj = poly[j]!.y;
    const intersect =
      yi > py !== yj > py &&
      px < ((xj - xi) * (py - yi)) / (yj - yi + Number.EPSILON) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function perp(cos: number, sin: number): { x: number; y: number } {
  return { x: -sin, y: cos };
}

function buildLinePolygon(
  ox: number,
  oy: number,
  angleRad: number,
  lengthPx: number,
  widthPx: number,
): { x: number; y: number }[] {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const { x: px, y: py } = perp(cos, sin);
  const hw = widthPx / 2;
  const nearL = { x: ox + px * hw, y: oy + py * hw };
  const nearR = { x: ox - px * hw, y: oy - py * hw };
  const farL = { x: nearL.x + cos * lengthPx, y: nearL.y + sin * lengthPx };
  const farR = { x: nearR.x + cos * lengthPx, y: nearR.y + sin * lengthPx };
  return [nearL, nearR, farR, farL];
}

function buildConePolygon(
  ox: number,
  oy: number,
  angleRad: number,
  lengthPx: number,
): { x: number; y: number }[] {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const { x: px, y: py } = perp(cos, sin);
  const halfWidth = lengthPx / 2;
  const endX = ox + cos * lengthPx;
  const endY = oy + sin * lengthPx;
  return [
    { x: ox, y: oy },
    { x: endX + px * halfWidth, y: endY + py * halfWidth },
    { x: endX - px * halfWidth, y: endY - py * halfWidth },
  ];
}

function buildSquarePolygon(
  cx: number,
  cy: number,
  sidePx: number,
  angleRad: number,
): { x: number; y: number }[] {
  const hw = sidePx / 2;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const corners = [
    [-hw, -hw],
    [hw, -hw],
    [hw, hw],
    [-hw, hw],
  ];
  return corners.map(([lx, ly]) => ({
    x: cx + lx! * cos - ly! * sin,
    y: cy + lx! * sin + ly! * cos,
  }));
}

function buildCirclePolygon(cx: number, cy: number, radiusPx: number, segments = 48): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(a) * radiusPx, y: cy + Math.sin(a) * radiusPx });
  }
  return pts;
}

/** Build the world-space polygon for an AoE template. */
export function buildAoePolygon(
  aoe: { size: number; type: string },
  placement: AoePlacement,
  gridSize: number,
): { x: number; y: number }[] {
  const type = aoe.type.toLowerCase();
  const sizePx = feetToPixels(aoe.size, gridSize);

  if (type === 'line') {
    return buildLinePolygon(
      placement.originX,
      placement.originY,
      placement.angleRad,
      sizePx,
      feetToPixels(LINE_AOE_WIDTH_FT, gridSize),
    );
  }
  if (type === 'cone') {
    return buildConePolygon(placement.originX, placement.originY, placement.angleRad, sizePx);
  }
  if (type === 'cube') {
    return buildSquarePolygon(placement.centerX, placement.centerY, sizePx, placement.angleRad);
  }
  if (type === 'sphere' || type === 'radius' || type === 'cylinder') {
    return buildCirclePolygon(placement.centerX, placement.centerY, sizePx);
  }
  return buildCirclePolygon(placement.centerX, placement.centerY, sizePx);
}

export function placementFromCursor(
  aoe: { size: number; type: string },
  originX: number,
  originY: number,
  cursorX: number,
  cursorY: number,
): AoePlacement {
  const angleRad = angleBetween(originX, originY, cursorX, cursorY);
  return {
    originX,
    originY,
    angleRad,
    centerX: isDirectedAoe(aoe.type) ? originX : cursorX,
    centerY: isDirectedAoe(aoe.type) ? originY : cursorY,
  };
}

export function tokensInAoe(
  tokens: TokenItem[],
  aoe: { size: number; type: string },
  placement: AoePlacement,
  gridSize: number,
  excludeTokenId?: string,
): TokenItem[] {
  const poly = buildAoePolygon(aoe, placement, gridSize);
  return tokens.filter((t) => {
    if (excludeTokenId && t.id === excludeTokenId) return false;
    const { cx, cy } = itemCenter(t);
    return pointInPolygon(cx, cy, poly);
  });
}
