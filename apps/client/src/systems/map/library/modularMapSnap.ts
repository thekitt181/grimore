import type { MapItem } from '@/systems/scene/types';
import {
  type Cardinal,
  type ModularPiece,
  footprintPx,
  isModularGate,
  isModularMap,
  joinMeters,
  modularScaleOf,
  snapModularOriginToGrid,
  pieceForUrl,
  MODULAR_PX_PER_UNIT,
} from './modularKits';

export {
  isModularMap,
  isModularGate,
  isModularFloorTile,
  isModularDeadEnd,
  modularScaleOf,
  snapModularOriginToGrid,
  footprintPx,
  joinMeters,
  pieceForUrl,
  modularGridDefaults,
  modularDepthStretch,
  modularWidthStretch,
  MODULAR_PX_PER_UNIT,
  MODULAR_SNAP_REV,
} from './modularKits';
export type { ModularPiece } from './modularKits';

export const MODULAR_DRAG_SNAP_PX = MODULAR_PX_PER_UNIT * 2.5;
export const MODULAR_PLACE_SNAP_PX = MODULAR_PX_PER_UNIT * 1.5;

const ORDER: Cardinal[] = ['N', 'E', 'S', 'W'];
const OPPOSITE: Record<Cardinal, Cardinal> = { N: 'S', S: 'N', E: 'W', W: 'E' };

export type ModularSnapPose = {
  x: number;
  y: number;
  rotation: number;
  width: number;
  height: number;
};

function snapRot(deg: number): number {
  return ((Math.round(deg / 90) * 90) % 360 + 360) % 360;
}

/** Map meshes yaw CCW from above (`degToRad(item.rotation)`). */
function rotCard(side: Cardinal, rotDeg: number): Cardinal {
  const steps = ((Math.round(rotDeg / 90) % 4) + 4) % 4;
  return ORDER[(ORDER.indexOf(side) - steps + 4) % 4]!;
}

function openingsWorld(piece: ModularPiece, rotDeg: number): Cardinal[] {
  return piece.openings.map((s) => rotCard(s, snapRot(rotDeg)));
}

/** Walls join on ends too (long runs); floors join on every edge. */
function joinSidesWorld(piece: ModularPiece, rotDeg: number): Cardinal[] {
  if (piece.kind === 'wall' || piece.kind === 'tile') return ORDER;
  return openingsWorld(piece, rotDeg);
}

function worldAabb(box: Pick<MapItem, 'x' | 'y' | 'width' | 'height' | 'rotation'>) {
  const rot = snapRot(box.rotation ?? 0);
  const swap = rot === 90 || rot === 270;
  const w = swap ? box.height : box.width;
  const h = swap ? box.width : box.height;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  return { x: cx - w / 2, y: cy - h / 2, width: w, height: h };
}

/** Join footprint at the item's center — uses the piece's current snap scale. */
function joinAabb(
  map: Pick<MapItem, 'x' | 'y' | 'width' | 'height' | 'rotation' | 'modelUrl'>,
  piece: ModularPiece,
) {
  const fp = footprintPx(piece, modularScaleOf(map));
  return worldAabb({
    x: map.x + map.width / 2 - fp.width / 2,
    y: map.y + map.height / 2 - fp.height / 2,
    width: fp.width,
    height: fp.height,
    rotation: map.rotation,
  });
}

function authoredAlongM(piece: ModularPiece, rotDeg: number, alongNS: boolean): number {
  const j = joinMeters(piece);
  const swap = snapRot(rotDeg) === 90 || snapRot(rotDeg) === 270;
  const w = swap ? j.h : j.w;
  const h = swap ? j.w : j.h;
  return alongNS ? w : h;
}

/** Kenney rooms: 2 m doors. Halls stay 4 m / 8 m modules. */
function passageAlongM(piece: ModularPiece, rotDeg: number, alongNS: boolean): number {
  if (piece.kind === 'room') return 2;
  if (piece.kind === 'hall' || piece.kind === 'stairs') {
    const j = joinMeters(piece);
    if (piece.kind === 'stairs') return piece.joinW ?? Math.min(j.w, 8);
    return Math.min(j.w, j.h);
  }
  return authoredAlongM(piece, rotDeg, alongNS);
}

function uniformScaleOf(map: Pick<MapItem, 'width' | 'height' | 'modelUrl'>): number {
  const piece = pieceForUrl(map.modelUrl);
  if (!piece) return 1;
  const base = footprintPx(piece, 1);
  const sx = map.width / base.width;
  const sy = map.height / base.height;
  const s = Math.min(sx, sy);
  if (!Number.isFinite(s) || s <= 0) return 1;
  return Math.max(0.25, Math.min(8, s));
}

/**
 * KayKit 2 m tiles ↔ 4 m tiles/walls only.
 * Kenney rooms/halls keep authored size — never shrink to a 2 m door or 4 m hex.
 */
function scaleToJoin(
  piece: ModularPiece,
  rotDeg: number,
  seatFacing: Cardinal,
  anchor: Pick<MapItem, 'width' | 'height' | 'rotation' | 'modelUrl'>,
  aPiece: ModularPiece,
): number {
  if (piece.kind === 'room' || piece.kind === 'hall' || piece.kind === 'stairs') {
    return 1;
  }
  const kaykitPair =
    piece.kit === 'kaykit'
    && aPiece.kit === 'kaykit'
    && (piece.kind === 'tile' || piece.kind === 'wall')
    && (aPiece.kind === 'tile' || aPiece.kind === 'wall');
  if (kaykitPair) {
    const ns = seatFacing === 'N' || seatFacing === 'S';
    const hostM = passageAlongM(aPiece, anchor.rotation ?? 0, ns);
    const moverM =
      piece.kind === 'wall'
        ? Math.max(joinMeters(piece).w, joinMeters(piece).h)
        : authoredAlongM(piece, rotDeg, ns);
    if (moverM > 1e-6) {
      return Math.max(0.25, Math.min(8, uniformScaleOf(anchor) * hostM / moverM));
    }
  }
  if (piece.kit === 'kaykit') return 1;
  return Math.max(0.25, Math.min(8, modularScaleOf(anchor)));
}

/** Straight N/S openings → wall runs east-west. */
function wallRunsEastWest(piece: ModularPiece, rotDeg: number): boolean {
  const sides = openingsWorld(piece, rotDeg);
  const ns = sides.includes('N') || sides.includes('S');
  const ew = sides.includes('E') || sides.includes('W');
  if (ns && !ew) return true;
  if (ew && !ns) return false;
  return ns;
}

function overlapsOtherMaps(
  poseBox: { x: number; y: number; width: number; height: number },
  others: readonly MapItem[],
  skipIds: ReadonlySet<string>,
  ignorePerpOf?: { piece: ModularPiece; rotation: number },
): boolean {
  for (const o of others) {
    if (skipIds.has(o.id)) continue;
    const op = pieceForUrl(o.modelUrl);
    // Kenney room/hall AABBs are larger than the mesh and were blocking KayKit wall-on-floor snaps.
    if (op?.kit === 'kenney') continue;
    if (
      ignorePerpOf
      && op?.kind === 'wall'
      && wallRunsEastWest(op, o.rotation ?? 0) !== wallRunsEastWest(ignorePerpOf.piece, ignorePerpOf.rotation)
    ) {
      continue;
    }
    const otherBox = op ? joinAabb(o, op) : worldAabb(o);
    if (aabbOverlapArea(poseBox, otherBox) > 8) return true;
  }
  return false;
}

function aabbOverlapArea(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): number {
  const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return x * y;
}

function entranceCenter(
  box: Pick<MapItem, 'x' | 'y' | 'width' | 'height' | 'rotation'>,
  side: Cardinal,
): { x: number; y: number } {
  const b = worldAabb(box);
  switch (side) {
    case 'N': return { x: b.x + b.width / 2, y: b.y };
    case 'S': return { x: b.x + b.width / 2, y: b.y + b.height };
    case 'E': return { x: b.x + b.width, y: b.y + b.height / 2 };
    case 'W': return { x: b.x, y: b.y + b.height / 2 };
  }
}

function isCenteredOpening(piece: ModularPiece): boolean {
  return /doorway|gated|window/.test(piece.key);
}

function snapAlong(
  anchorMin: number,
  anchorMax: number,
  moverLen: number,
  preferMin: number,
  cell: number,
  flush = false,
  center = false,
): number {
  const face = anchorMax - anchorMin;
  const start = anchorMin;
  const end = anchorMax - moverLen;
  if (center) return (anchorMin + anchorMax) / 2 - moverLen / 2;
  if (flush) {
    return Math.abs(preferMin - start) <= Math.abs(preferMin - end) ? start : end;
  }
  const centered = (anchorMin + anchorMax) / 2 - moverLen / 2;
  if (Math.abs(face - moverLen) <= cell * 0.15) return centered;
  let best = centered;
  let bestScore = Infinity;
  const lo = Math.floor((anchorMin - moverLen) / cell) * cell;
  const hi = Math.ceil(anchorMax / cell) * cell;
  for (let x = lo; x <= hi + cell * 0.01; x += cell) {
    const overlap = Math.min(x + moverLen, anchorMax) - Math.max(x, anchorMin);
    if (overlap < cell * 0.49) continue;
    const score = Math.abs(x - preferMin) + (Math.min(moverLen, face) - overlap) * 0.5;
    if (score < bestScore) {
      bestScore = score;
      best = x;
    }
  }
  return best;
}

function poseJoining(
  size: { width: number; height: number },
  rotation: number,
  moverSide: Cardinal,
  target: { x: number; y: number },
  along: { anchorMin: number; anchorMax: number; preferMin: number; cell: number; flush?: boolean; center?: boolean },
  kissPx = 0,
): ModularSnapPose {
  const rot = snapRot(rotation);
  const swap = rot === 90 || rot === 270;
  const worldW = swap ? size.height : size.width;
  const worldH = swap ? size.width : size.height;
  const ns = moverSide === 'N' || moverSide === 'S';
  const alongLen = ns ? worldW : worldH;
  const snappedAlong = snapAlong(
    along.anchorMin,
    along.anchorMax,
    alongLen,
    along.preferMin,
    along.cell,
    along.flush,
    along.center,
  );
  const k = kissPx;
  let wx: number;
  let wy: number;
  switch (moverSide) {
    case 'W': wx = target.x - k; wy = snappedAlong; break;
    case 'E': wx = target.x - worldW + k; wy = snappedAlong; break;
    case 'N': wx = snappedAlong; wy = target.y - k; break;
    default: wx = snappedAlong; wy = target.y - worldH + k; break;
  }
  return {
    x: wx + worldW / 2 - size.width / 2,
    y: wy + worldH / 2 - size.height / 2,
    rotation: rot,
    width: size.width,
    height: size.height,
  };
}

export function snapModularMapPose(
  moving: Pick<MapItem, 'id' | 'x' | 'y' | 'width' | 'height' | 'rotation' | 'modelUrl'>,
  others: readonly MapItem[],
  opts?: { maxDist?: number; keepScale?: boolean },
): ModularSnapPose | null {
  const piece = pieceForUrl(moving.modelUrl);
  if (!piece) return null;
  const anchors = others.filter((m) => m.id !== moving.id && isModularMap(m));
  if (anchors.length === 0) return null;

  const maxDist = opts?.maxDist ?? MODULAR_DRAG_SNAP_PX;
  const filler = piece.kind === 'gate';
  const baseRot = snapRot(moving.rotation ?? 0);
  const facing = joinSidesWorld(piece, baseRot);
  const movingBox = worldAabb({ ...moving, rotation: baseRot });

  let best: {
    pose: ModularSnapPose;
    score: number;
    seatFacing: Cardinal;
    lockAlong: boolean;
  } | null = null;

  for (const anchor of anchors) {
    const aPiece = pieceForUrl(anchor.modelUrl);
    if (!aPiece) continue;
    if (filler && aPiece.kind === 'gate') continue;
    // Kenney room/hall AABBs sit outside the mesh and pull KayKit walls off the floor rim.
    if (piece.kind === 'wall' && aPiece.kit === 'kenney') continue;
    const cell = MODULAR_PX_PER_UNIT;
    const wallOnFloor =
      (piece.kind === 'wall' && aPiece.kind === 'tile')
      || (piece.kind === 'tile' && aPiece.kind === 'wall');
    const floorOnFloor = piece.kind === 'tile' && aPiece.kind === 'tile';
    const rimJoin = wallOnFloor || floorOnFloor;
    const anchorBox = aPiece.kind === 'tile' ? worldAabb(anchor) : joinAabb(anchor, aPiece);
    const hostSides =
      aPiece.kit === 'kenney' && (piece.kind === 'tile' || piece.kind === 'wall')
        ? ORDER
        : joinSidesWorld(aPiece, anchor.rotation ?? 0);
    for (const anchorSide of hostSides) {
      const target = entranceCenter(
        { ...anchor, x: anchorBox.x, y: anchorBox.y, width: anchorBox.width, height: anchorBox.height, rotation: 0 },
        anchorSide,
      );
      const seatFacing = filler ? anchorSide : OPPOSITE[anchorSide];
      if (!facing.includes(seatFacing)) continue;
      // Straight walls run along a floor edge (long N/S), not butted on the short end.
      if (wallOnFloor) {
        const wallP = piece.kind === 'wall' ? piece : aPiece;
        const wallRot = piece.kind === 'wall' ? baseRot : (anchor.rotation ?? 0);
        const longSides = openingsWorld(wallP, wallRot);
        if (piece.kind === 'wall' && !longSides.includes(seatFacing)) continue;
        if (aPiece.kind === 'wall' && !longSides.includes(anchorSide)) continue;
      }
      const ns = seatFacing === 'N' || seatFacing === 'S';
      const fitted = footprintPx(
        piece,
        opts?.keepScale
          ? modularScaleOf(moving)
          : scaleToJoin(piece, baseRot, seatFacing, anchor, aPiece),
      );
      const opening = piece.kind === 'wall' ? piece : aPiece;
      const centerOpening = wallOnFloor && isCenteredOpening(opening);
      const pose = poseJoining(
        fitted,
        baseRot,
        seatFacing,
        target,
        {
          anchorMin: ns ? anchorBox.x : anchorBox.y,
          anchorMax: ns ? anchorBox.x + anchorBox.width : anchorBox.y + anchorBox.height,
          preferMin: ns ? movingBox.x : movingBox.y,
          cell,
          flush: wallOnFloor && /corner/.test(piece.key),
          center:
            centerOpening
            || floorOnFloor
            || wallOnFloor
            || aPiece.kind === 'room'
            || aPiece.kind === 'hall'
            || piece.kind === 'hall',
        },
        wallOnFloor ? 4 : 0,
      );
      const poseBox = worldAabb({
        x: pose.x,
        y: pose.y,
        width: pose.width,
        height: pose.height,
        rotation: pose.rotation,
      });
      if (
        !filler
        && !floorOnFloor
        && overlapsOtherMaps(
          poseBox,
          anchors,
          new Set(rimJoin ? [moving.id, anchor.id] : [moving.id]),
          wallOnFloor && piece.kind === 'wall'
            ? { piece, rotation: baseRot }
            : undefined,
        )
      ) {
        continue;
      }
      const curFace = entranceCenter({ ...moving, rotation: baseRot }, seatFacing);
      const nDist = ns ? Math.abs(curFace.y - target.y) : Math.abs(curFace.x - target.x);
      const aDist = ns ? Math.abs(curFace.x - target.x) : Math.abs(curFace.y - target.y);
      const overlappingNow = aabbOverlapArea(movingBox, anchorBox) > 8;
      const nearFloor =
        rimJoin
        && aabbOverlapArea(movingBox, {
          x: anchorBox.x - maxDist,
          y: anchorBox.y - maxDist,
          width: anchorBox.width + maxDist * 2,
          height: anchorBox.height + maxDist * 2,
        }) > 0;
      // Sitting on / next to a floor: pull to the nearest rim, not the far side.
      if (rimJoin && (overlappingNow || nearFloor)) {
        const toRim = ns
          ? Math.abs(movingBox.y + movingBox.height / 2 - target.y)
          : Math.abs(movingBox.x + movingBox.width / 2 - target.x);
        const score = toRim + aDist * 0.15 - maxDist * 4;
        if (!best || score < best.score) {
          best = {
            pose,
            score,
            seatFacing,
            lockAlong: aPiece.kind === 'room' || wallOnFloor,
          };
        }
        continue;
      }
      const thickness = ns ? movingBox.height : movingBox.width;
      const reach = overlappingNow ? maxDist + thickness : rimJoin ? maxDist * 2 : maxDist;
      const alongSpan = ns
        ? Math.max(movingBox.width, anchorBox.width)
        : Math.max(movingBox.height, anchorBox.height);
      const alongSlack = rimJoin ? Math.max(cell, alongSpan) : Math.max(cell, alongSpan * 0.5);
      if (nDist > reach || aDist > alongSlack) continue;
      const score = nDist + aDist * 0.4 + (rimJoin ? -maxDist : 0);
      if (!best || score < best.score) {
        best = {
          pose,
          score,
          seatFacing,
          lockAlong: aPiece.kind === 'room' || wallOnFloor,
        };
      }
    }
  }
  if (!best) return null;
  // Doorway joins stay centered on the opening.
  if (best.lockAlong) return best.pose;
  const grid = snapModularOriginToGrid(best.pose.x, best.pose.y);
  const ns = best.seatFacing === 'N' || best.seatFacing === 'S';
  return {
    ...best.pose,
    x: ns ? grid.x : best.pose.x,
    y: ns ? best.pose.y : grid.y,
  };
}

export function placeModularMap(
  piece: ModularPiece,
  existing: readonly MapItem[],
  preferAnchorId?: string | null,
): ModularSnapPose {
  const size = footprintPx(piece);
  const anchors = existing.filter((m) => isModularMap(m) && (piece.kind !== 'gate' || !isModularGate(m)));
  if (anchors.length === 0) {
    return { x: 0, y: 0, rotation: 0, ...size };
  }
  const prefer =
    (preferAnchorId ? anchors.find((a) => a.id === preferAnchorId) : undefined)
    ?? anchors[anchors.length - 1]!;
  const heading = snapRot(prefer.rotation ?? 0);
  const aPiece = pieceForUrl(prefer.modelUrl);
  const fitted = footprintPx(piece, 1);
  if (!aPiece) {
    const origin = snapModularOriginToGrid(prefer.x + prefer.width, prefer.y);
    return { x: origin.x, y: origin.y, rotation: heading, ...fitted };
  }

  let best: ModularSnapPose | null = null;
  let bestScore = Infinity;
  const placeDist = MODULAR_PLACE_SNAP_PX;
  const hostSides =
    aPiece.kit === 'kenney' && (piece.kind === 'tile' || piece.kind === 'wall')
      ? ORDER
      : joinSidesWorld(aPiece, prefer.rotation ?? 0);
  const preferBox = aPiece.kind === 'tile' ? worldAabb(prefer) : joinAabb(prefer, aPiece);
  for (const side of hostSides) {
    const sized = fitted;
    const target = entranceCenter(
      { ...prefer, x: preferBox.x, y: preferBox.y, width: preferBox.width, height: preferBox.height, rotation: 0 },
      side,
    );
    const seed = {
      id: '__placing__',
      x: target.x - sized.width / 2,
      y: target.y - sized.height / 2,
      width: sized.width,
      height: sized.height,
      rotation: heading,
      modelUrl: piece.url,
    };
    const snapped = snapModularMapPose(seed, [prefer], { maxDist: placeDist });
    if (!snapped) continue;
    const d = Math.hypot(
      snapped.x + snapped.width / 2 - target.x,
      snapped.y + snapped.height / 2 - target.y,
    );
    if (d < bestScore) {
      bestScore = d;
      best = snapped;
    }
  }
  const fallback = snapModularOriginToGrid(preferBox.x + preferBox.width, preferBox.y);
  return best ?? { x: fallback.x, y: fallback.y, rotation: heading, ...fitted };
}
