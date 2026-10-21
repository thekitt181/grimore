import type { DungeonFloorLink } from '@/systems/scene/types';
import type { MapItem } from '@/systems/scene/types';
import {
  generateDungeon,
  type DungeonOptions,
  type DungeonRoom,
  type GeneratedDungeon,
  type StairsStyle,
} from './generateDungeon';

export function floorSeed(seed: number, floor: number): number {
  let hash = (seed ^ Math.imul(floor, 0x9e3779b1)) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d);
  hash = Math.imul(hash ^ (hash >>> 15), 0x846ca68b);
  return (hash ^ (hash >>> 16)) >>> 0;
}

export function stairsStyleForFloor(link: DungeonFloorLink): StairsStyle {
  const count = link.floorCount ?? 1;
  const floor = link.floor ?? 1;
  if (count === 1) return link.options.stairs ?? 'down';
  if (floor === count) return 'up';
  if (floor === 1) return 'down';
  return 'both';
}

function mergeSavedRooms(generated: GeneratedDungeon, saved?: DungeonFloorLink['rooms']): DungeonRoom[] {
  if (!saved?.length) return generated.rooms;
  return generated.rooms.map((room) => {
    const hit =
      saved.find((s) => s.id === room.id)
      ?? saved.find((s) => s.x === room.x && s.y === room.y && s.w === room.w && s.h === room.h);
    if (!hit) return room;
    return { ...room, title: hit.title, notes: [...hit.notes] };
  });
}

/** Rebuild layout grid from saved generator options (same seed → same cells as when placed). */
export function regenerateDungeonForMap(map: MapItem): GeneratedDungeon | null {
  const link = map.dungeon;
  if (!link) return null;
  const floor = link.floor ?? 1;
  const seed = floor === 1 ? link.options.seed : floorSeed(link.options.seed, floor);
  const opts: DungeonOptions = {
    layout: link.options.layout,
    size: link.options.size,
    doors: link.options.doors,
    seed,
    motif: link.options.motif,
    corridors: link.options.corridors,
    passages: link.options.passages,
    deadEnds: link.options.deadEnds,
    stairs: stairsStyleForFloor(link),
    key: link.options.key,
    secrets: link.options.secrets,
    cavern: link.options.cavern,
    density: link.options.density ?? 'normal',
    furnishings: link.options.furnishings ?? 'full',
    chambers: link.options.chambers ?? 'normal',
  };
  const generated = generateDungeon(opts);
  return {
    ...generated,
    cols: link.cols,
    rows: link.rows,
    cell: link.cell,
    rooms: mergeSavedRooms(generated, link.rooms),
    stairs: link.stairs.map((st) => ({
      x: st.col,
      y: st.row,
      direction: st.direction,
    })),
  };
}
