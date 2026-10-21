import type { Point } from '@grimoire/fog-engine';
import type { ImageItem, Item, MapItem, WallSegment } from '@/systems/scene/types';
import { resolvePropId } from './dungeonProps';
import { canonicalPropId } from './propArt';
import { isDoorPropId } from './doorCollision';

/** Solid obstacles — block token drag + first-person walk (sized to footprint). */
const BLOCKING_PROP_IDS = new Set([
  'boulder',
  'column',
  'statue',
  'idol',
  'angel',
  'chest',
  'sarcophagus',
  'crate',
  'barrel',
  'keg',
  'altar',
  'pedestal',
  'shop',
  'arch',
  'dry-fountain',
  'fountain',
  'blood-fountain',
  'hatch',
  'grate',
  'net',
  'weapon-rack',
  'cage',
]);

/** Collision inset vs visible sprite (0–1 on each axis). */
function blockScale(propId: string): number {
  switch (propId) {
    case 'boulder':
      return 0.9;
    case 'column':
    case 'statue':
    case 'idol':
    case 'angel':
      return 0.72;
    case 'chest':
    case 'sarcophagus':
      return 0.84;
    case 'crate':
    case 'barrel':
    case 'keg':
      return 0.78;
    case 'weapon-rack':
      return 0.86;
    case 'cage':
      return 0.82;
    case 'altar':
    case 'shop':
      return 0.88;
    case 'pedestal':
      return 0.65;
    case 'arch':
      return 0.92;
    case 'dry-fountain':
    case 'fountain':
    case 'blood-fountain':
      return 0.8;
    case 'hatch':
      return 0.85;
    case 'grate':
      return 0.7;
    case 'net':
      return 0.75;
    case 'ladder':
      return 0.55;
    default:
      return 0.8;
  }
}

function imageMapCenter(item: ImageItem, map: MapItem): Point {
  const wx = item.x + item.width / 2;
  const wy = item.y + item.height / 2;
  const cx = map.x + map.width / 2;
  const cy = map.y + map.height / 2;
  const rad = (-map.rotation * Math.PI) / 180;
  const dx = wx - cx;
  const dy = wy - cy;
  return {
    x: dx * Math.cos(rad) - dy * Math.sin(rad) + map.width / 2,
    y: dx * Math.sin(rad) + dy * Math.cos(rad) + map.height / 2,
  };
}

function footprintCorners(
  item: ImageItem,
  map: MapItem,
  scale: number,
): Point[] {
  const c = imageMapCenter(item, map);
  const rad = ((item.rotation - map.rotation) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const hx = (item.width * scale) / 2;
  const hy = (item.height * scale) / 2;
  const local: Array<[number, number]> = [
    [-hx, -hy],
    [hx, -hy],
    [hx, hy],
    [-hx, hy],
  ];
  return local.map(([lx, ly]) => ({
    x: c.x + lx * cos - ly * sin,
    y: c.y + lx * sin + ly * cos,
  }));
}

function rectWallLoop(corners: Point[]): WallSegment[] {
  if (corners.length < 4) return [];
  return [
    { a: corners[0]!, b: corners[1]! },
    { a: corners[1]!, b: corners[2]! },
    { a: corners[2]!, b: corners[3]! },
    { a: corners[3]!, b: corners[0]! },
  ];
}

export function isBlockingPropItem(item: ImageItem): boolean {
  if (item.visible === false) return false;
  const id = resolvePropId(item);
  if (!id) return false;
  const key = canonicalPropId(id);
  if (isDoorPropId(key)) return false;
  if (key === 'hatch' && (item.propState ?? 0) > 0) return false;
  if (key === 'net' && (item.propState ?? 0) > 0) return false;
  if (key === 'shop' && (item.propState ?? 0) > 0) return false;
  return BLOCKING_PROP_IDS.has(key);
}

export function blockingPropsOnMap(
  items: Record<string, Item> | Item[],
  map: MapItem,
): ImageItem[] {
  const list = Array.isArray(items) ? items : Object.values(items);
  return list.filter((i): i is ImageItem => {
    if (i.type !== 'image' || !isBlockingPropItem(i)) return false;
    const c = imageMapCenter(i, map);
    return c.x >= -i.width && c.y >= -i.height && c.x <= map.width + i.width && c.y <= map.height + i.height;
  });
}

export function propObstacleWalls(map: MapItem, items: Record<string, Item> | Item[]): WallSegment[] {
  const out: WallSegment[] = [];
  for (const item of blockingPropsOnMap(items, map)) {
    const id = canonicalPropId(resolvePropId(item)!);
    const scale = blockScale(id);
    out.push(...rectWallLoop(footprintCorners(item, map, scale)));
  }
  return out;
}

export function propObstacleSignature(map: MapItem, items: Record<string, Item> | Item[]): string {
  return blockingPropsOnMap(items, map)
    .map((p) => {
      const id = resolvePropId(p) ?? '?';
      const open = (p.propState ?? 0) > 0 ? 1 : 0;
      return `${p.id}:${id}${open}:${p.x.toFixed(0)},${p.y.toFixed(0)},${p.width.toFixed(0)},${p.height.toFixed(0)},${p.rotation.toFixed(0)}`;
    })
    .sort()
    .join(',');
}
