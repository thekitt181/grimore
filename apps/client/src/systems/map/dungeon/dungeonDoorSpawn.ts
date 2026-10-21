import { v4 as uuidv4 } from 'uuid';
import type { DoorKind, DungeonRoom, GeneratedDungeon } from './generateDungeon';
import type { ImageItem, MapItem } from '@/systems/scene/types';
import { ensurePropCatalogEntry } from '@/systems/map/props/propArt';
import { fitDoorOrGateOnMap } from '@/systems/map/props/doorFit';
import { worldToMapLocal } from '@/systems/map/wallUtils';
import { isDoorPropId } from '@/systems/map/props/doorCollision';

interface DoorEdge {
  key: string;
  x: number;
  y: number;
  nx: number;
  ny: number;
  kind: DoorKind;
}

interface DoorSpec {
  propId: string;
  visible: boolean;
  propRevealDc?: number;
  propRevealCheck?: string;
  propActivateDc?: number;
  propActivateCheck?: string;
}

function parseEdgeKey(key: string): { x: number; y: number; nx: number; ny: number } | null {
  const m = /^(\d+),(\d+),(e|s)$/.exec(key);
  if (!m) return null;
  const x = Number(m[1]);
  const y = Number(m[2]);
  if (m[3] === 'e') return { x, y, nx: x + 1, ny: y };
  return { x, y, nx: x, ny: y + 1 };
}

function doorEntries(doors: GeneratedDungeon['doors']): DoorEdge[] {
  const out: DoorEdge[] = [];
  const iter = doors instanceof Map ? doors.entries() : Object.entries(doors as Record<string, DoorKind>);
  for (const [key, kind] of iter) {
    const edge = parseEdgeKey(key);
    if (!edge) continue;
    out.push({ key, ...edge, kind });
  }
  return out;
}

function roomAt(rooms: DungeonRoom[], x: number, y: number): DungeonRoom | undefined {
  return rooms.find((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
}

function sideName(from: { x: number; y: number }, to: { x: number; y: number }): string {
  if (to.x > from.x) return 'East';
  if (to.x < from.x) return 'West';
  if (to.y > from.y) return 'South';
  return 'North';
}

function roomSideNote(room: DungeonRoom | undefined, side: string): string {
  if (!room) return '';
  const prefix = `${side}:`;
  const line = room.notes.find((n) => n.startsWith(prefix));
  return line ? line.slice(prefix.length).trim() : '';
}

/**
 * Pick a prop for this edge only.
 * Use the matching side note for flavor (gate / runed / hatch) — never the whole room
 * blob, or every open doorway in a room with one "closed door" note grows a stacked door.
 */
function specFromDoor(kind: DoorKind, sideLine: string): DoorSpec | null {
  // Open passages are painted openings — no interactive door prop.
  if (kind === 'open') return null;

  const side = sideLine.toLowerCase();

  if (kind === 'secret' || /secret door|illusionary wall|hidden door|secret passage/i.test(side)) {
    return {
      propId: 'secret-door',
      visible: false,
      propRevealDc: 15,
      propRevealCheck: 'investigation',
    };
  }
  if (/portcullis|iron grate|\bgate\b|rusted portcullis/i.test(side)) {
    return { propId: 'gate', visible: true };
  }
  if (/runed door|glyph door|sealed rune/i.test(side)) {
    return { propId: 'runed-door', visible: true, propActivateDc: 16, propActivateCheck: 'investigation' };
  }
  if (/hatch|trap door|trapdoor/i.test(side)) {
    return { propId: 'hatch', visible: true };
  }
  if (kind === 'locked' || /locked door/i.test(side)) {
    return {
      propId: 'door',
      visible: true,
      propActivateDc: 15,
      propActivateCheck: 'strength',
    };
  }
  if (kind === 'closed' || /closed door|iron door|wooden door/i.test(side)) {
    return { propId: 'door', visible: true };
  }
  // Kind says closed/locked/secret but note is empty — still place a basic door.
  if (kind === 'closed') return { propId: 'door', visible: true };
  if (kind === 'locked') {
    return {
      propId: 'door',
      visible: true,
      propActivateDc: 15,
      propActivateCheck: 'strength',
    };
  }
  if (kind === 'secret') {
    return {
      propId: 'secret-door',
      visible: false,
      propRevealDc: 15,
      propRevealCheck: 'investigation',
    };
  }
  return null;
}

function edgeLocalMid(cell: number, x: number, y: number, nx: number, ny: number): { lx: number; ly: number } {
  if (nx === x + 1 && ny === y) {
    return { lx: (x + 1) * cell, ly: y * cell + cell / 2 };
  }
  if (nx === x && ny === y + 1) {
    return { lx: x * cell + cell / 2, ly: (y + 1) * cell };
  }
  return { lx: x * cell + cell / 2, ly: y * cell + cell / 2 };
}

function insideCell(x: number, y: number, nx: number, ny: number, room: DungeonRoom): { col: number; row: number } | null {
  if (x >= room.x && x < room.x + room.w && y >= room.y && y < room.y + room.h) return { col: x, row: y };
  if (nx >= room.x && nx < room.x + room.w && ny >= room.y && ny < room.y + room.h) return { col: nx, row: ny };
  return null;
}

function makeDoorItem(
  map: MapItem,
  cell: number,
  spec: DoorSpec,
  wx: number,
  wy: number,
  fallbackCol: number,
  fallbackRow: number,
): ImageItem | null {
  const art = ensurePropCatalogEntry(spec.propId);
  if (!art) return null;

  let x = map.x + fallbackCol * cell;
  let y = map.y + fallbackRow * cell;
  let width = cell;
  let height = cell;
  let rotation = 0;

  if (isDoorPropId(spec.propId)) {
    const fit = fitDoorOrGateOnMap(map, wx, wy, spec.propId);
    if (fit) {
      x = fit.x;
      y = fit.y;
      width = fit.width;
      height = fit.height;
      rotation = fit.rotation;
    }
  } else {
    const size = cell * 0.92;
    x = map.x + fallbackCol * cell + (cell - size) / 2;
    y = map.y + fallbackRow * cell + (cell - size) / 2;
    width = size;
    height = size;
  }

  return {
    id: uuidv4(),
    type: 'image',
    name: art.name,
    imageUrl: art.rest,
    propId: spec.propId,
    propState: 0,
    propNeedsDmApprove: true,
    x,
    y,
    rotation,
    width,
    height,
    zIndex: 3 + fallbackCol * 0.001 + fallbackRow * 0.001,
    locked: true,
    visible: spec.visible,
    dungeonPropForMapId: map.id,
    ...(() => {
      const local = worldToMapLocal(x, y, map);
      return {
        propMapLocalX: local.x,
        propMapLocalY: local.y,
        propMapLocalRotation: rotation - map.rotation,
      };
    })(),
    ...(spec.propRevealDc ? { propRevealDc: spec.propRevealDc } : {}),
    ...(spec.propRevealCheck ? { propRevealCheck: spec.propRevealCheck } : {}),
    ...(spec.propActivateDc ? { propActivateDc: spec.propActivateDc } : {}),
    ...(spec.propActivateCheck ? { propActivateCheck: spec.propActivateCheck } : {}),
  };
}

function centersTooClose(a: ImageItem, b: ImageItem, minDist: number): boolean {
  const ax = a.x + a.width / 2;
  const ay = a.y + a.height / 2;
  const bx = b.x + b.width / 2;
  const by = b.y + b.height / 2;
  return Math.hypot(ax - bx, ay - by) < minDist;
}

/** Doors / gates / secret doors from generator door map + matching side notes only. */
export function buildDungeonDoorItems(map: MapItem, dungeon: GeneratedDungeon): ImageItem[] {
  const cell = dungeon.cell;
  const items: ImageItem[] = [];
  const used = new Set<string>();
  /** After fitDoorOrGateOnMap, reject a second prop snapped onto the same opening. */
  const minCenterDist = Math.max(cell * 0.45, 28);

  for (const edge of doorEntries(dungeon.doors)) {
    if (used.has(edge.key)) continue;

    const room =
      roomAt(dungeon.rooms, edge.x, edge.y)
      ?? roomAt(dungeon.rooms, edge.nx, edge.ny);
    const from =
      room && roomAt(dungeon.rooms, edge.x, edge.y) === room
        ? { x: edge.x, y: edge.y }
        : { x: edge.nx, y: edge.ny };
    const to = from.x === edge.x && from.y === edge.y
      ? { x: edge.nx, y: edge.ny }
      : { x: edge.x, y: edge.y };
    const side = sideName(from, to);
    const sideLine = roomSideNote(room, side);
    const spec = specFromDoor(edge.kind, sideLine);
    if (!spec) continue;

    used.add(edge.key);
    const mid = edgeLocalMid(cell, edge.x, edge.y, edge.nx, edge.ny);
    const wx = map.x + map.gridOffsetX + mid.lx;
    const wy = map.y + map.gridOffsetY + mid.ly;
    const inside = room ? insideCell(edge.x, edge.y, edge.nx, edge.ny, room) : null;
    const fbCol = inside?.col ?? edge.x;
    const fbRow = inside?.row ?? edge.y;

    const item = makeDoorItem(map, cell, spec, wx, wy, fbCol, fbRow);
    if (!item) continue;
    if (items.some((prev) => centersTooClose(prev, item, minCenterDist))) continue;
    items.push(item);
  }

  return items;
}
