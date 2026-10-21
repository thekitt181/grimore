import { v4 as uuidv4 } from 'uuid';
import type {
  DungeonMotif,
  DungeonRoom,
  DungeonStair,
  FurnishingStyle,
  GeneratedDungeon,
} from './generateDungeon';
import type { ImageItem, MapItem } from '@/systems/scene/types';
import { canonicalPropId, ensurePropCatalogEntry, propIdsFromNoteText } from '@/systems/map/props/propArt';
import { isDoorPropId } from '@/systems/map/props/doorCollision';

type SpawnSlot = 'center' | 'edge' | 'corner';

interface PropSpawnPlan {
  propId: string;
  slot: SpawnSlot;
  scale?: number;
}

const RULES: Array<{ test: RegExp; props: PropSpawnPlan[] }> = [
  { test: /chest|stash|pay chest|cache|strongbox/i, props: [{ propId: 'chest', slot: 'center' }] },
  { test: /coin|offering|funeral coin|silverware/i, props: [{ propId: 'coins', slot: 'center', scale: 0.75 }] },
  { test: /ore|gem|uncut|slag|claim token/i, props: [{ propId: 'coins', slot: 'center' }, { propId: 'boulder', slot: 'edge', scale: 0.9 }] },
  { test: /sarcophagus|canopic|niche|shroud/i, props: [{ propId: 'sarcophagus', slot: 'center' }] },
  { test: /altar|reliquary|font|mosaic|saint/i, props: [{ propId: 'altar', slot: 'center' }, { propId: 'pedestal', slot: 'edge' }] },
  { test: /empty cage|\bcage\b/i, props: [{ propId: 'cage', slot: 'center', scale: 0.95 }] },
  { test: /faded mural|\bmural\b/i, props: [{ propId: 'mural', slot: 'edge', scale: 1.05 }] },
  { test: /art object|figurine|statuette/i, props: [{ propId: 'art-object', slot: 'center', scale: 0.72 }] },
  { test: /swarm roosting|roosting overhead/i, props: [{ propId: 'swarm', slot: 'center', scale: 0.88 }] },
  { test: /glyph cut into the floor|floor glyph|\bglyph\b/i, props: [{ propId: 'floor-glyph', slot: 'center', scale: 0.85 }] },
  { test: /tripwire/i, props: [{ propId: 'tripwire', slot: 'edge', scale: 0.92 }] },
  { test: /torch|sconce|candle|incense|votive/i, props: [{ propId: 'torch', slot: 'edge' }] },
  { test: /campfire|hearth|cold hearth/i, props: [{ propId: 'campfire', slot: 'center' }] },
  { test: /bone|skull|corpse|skeleton|grave dust/i, props: [{ propId: 'skeleton', slot: 'center' }, { propId: 'skull', slot: 'edge' }] },
  { test: /weapon rack|weapon racks|spare weapons|rack of weapons/i, props: [{ propId: 'weapon-rack', slot: 'edge', scale: 1.08 }] },
  { test: /weapon|blade|sword|spear|crossbow|helm/i, props: [{ propId: 'sword', slot: 'edge' }] },
  { test: /barrel|keg/i, props: [{ propId: 'barrel', slot: 'edge' }] },
  { test: /crate|cart|ration|store/i, props: [{ propId: 'crate', slot: 'edge' }] },
  { test: /timber|prop|beam|rafter/i, props: [{ propId: 'column', slot: 'edge', scale: 0.85 }] },
  { test: /pillar|column|row of pillars/i, props: [{ propId: 'column', slot: 'center', scale: 1.05 }] },
  { test: /boulder|rubble|rock|cave-in|shift/i, props: [{ propId: 'boulder', slot: 'edge' }] },
  { test: /pool|water|drip|pump|well|font chamber/i, props: [{ propId: 'dry-fountain', slot: 'center' }] },
  { test: /pressure plate|\bplate\b/i, props: [{ propId: 'plate', slot: 'center', scale: 0.9 }] },
  { test: /spear niche|murder hole|spike/i, props: [{ propId: 'spear', slot: 'edge' }] },
  { test: /bell rope/i, props: [{ propId: 'gate', slot: 'edge' }] },
  { test: /arrow slit|arrow trap|dart|bolt trap|crossbow/i, props: [{ propId: 'arrows', slot: 'edge' }] },
  { test: /blade trap|axe trap|caltrop/i, props: [{ propId: 'blade', slot: 'center' }] },
  { test: /book|scroll|spellbook|prayer book|map case|archive/i, props: [{ propId: 'book', slot: 'center' }, { propId: 'scroll', slot: 'edge' }] },
  { test: /potion|jar|canopic/i, props: [{ propId: 'potion', slot: 'center' }] },
  { test: /ring|signet|seal|locket/i, props: [{ propId: 'ring', slot: 'center', scale: 0.7 }] },
  { test: /key|keys/i, props: [{ propId: 'key', slot: 'center', scale: 0.65 }] },
  { test: /fungus|moss|mold|roots/i, props: [{ propId: 'mold', slot: 'edge' }, { propId: 'mushroom', slot: 'corner' }] },
  { test: /statue|idol|angel|kneeling figure/i, props: [{ propId: 'statue', slot: 'center' }] },
  { test: /shop|merchant|offering hall/i, props: [{ propId: 'shop', slot: 'center' }] },
  { test: /rail|cart dock|lift cage/i, props: [{ propId: 'crate', slot: 'edge' }, { propId: 'boulder', slot: 'corner', scale: 0.8 }] },
];

/** Doorways — only `dungeonDoorSpawn` places these (wall openings). */
function isDoorwayPropId(propId: string): boolean {
  const id = canonicalPropId(propId);
  return isDoorPropId(id) || id === 'hatch';
}

function withoutDoorwayProps(plans: PropSpawnPlan[]): PropSpawnPlan[] {
  return plans.filter((p) => !isDoorwayPropId(p.propId));
}

const MOTIF_AMBIENT: Record<DungeonMotif, string[]> = {
  mixed: ['torch', 'boulder'],
  crypt: ['torch', 'skeleton'],
  temple: ['torch', 'altar'],
  fortress: ['torch', 'crate'],
  mine: ['torch', 'boulder', 'coins'],
  ruin: ['torch', 'boulder', 'mold'],
};

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function propDef(propId: string) {
  const art = ensurePropCatalogEntry(propId);
  if (!art) return null;
  return {
    id: art.id,
    name: art.name,
    imageUrl: art.rest,
  };
}

function plansFromText(text: string): PropSpawnPlan[] {
  const out: PropSpawnPlan[] = [];
  for (const rule of RULES) {
    if (!rule.test.test(text)) continue;
    out.push(...rule.props);
  }
  return out;
}

function plansFromNotePhrases(note: string): PropSpawnPlan[] {
  if (/^(North|South|East|West):/i.test(note)) return [];
  const plans: PropSpawnPlan[] = [];
  for (const id of propIdsFromNoteText(note)) {
    if (isDoorwayPropId(id)) continue;
    if (propDef(id)) {
      plans.push({
        propId: id,
        slot: /trap|plate|arrow|spear|blade|dart|bolt|net|alarm|teleport/i.test(note) ? 'center' : 'edge',
      });
    }
  }
  return plans;
}

function plansFromRoom(
  room: DungeonRoom,
  motif: DungeonMotif,
  furnishings: FurnishingStyle,
): PropSpawnPlan[] {
  if (furnishings === 'none') return [];
  const plans: PropSpawnPlan[] = [];
  for (const note of room.notes) {
    const lower = note.toLowerCase();
    if (lower.includes('stairs lead') || lower.startsWith('the way in')) continue;
    if (/^(North|South|East|West):/i.test(note)) continue;
    const body = note.replace(/^(Feature|Hazard|Find):\s*/i, '');
    plans.push(...plansFromText(body));
    plans.push(...plansFromNotePhrases(note));
  }
  if (room.title === 'Entrance' || room.notes.some((n) => n.toLowerCase().includes('way in'))) {
    plans.push({ propId: 'torch', slot: 'edge' });
  }
  if (
    room.title === 'Reward'
    || room.notes.some((n) => /^Find:/i.test(n) && /chest|coins|treasure|hoard|stash|strongbox/i.test(n))
  ) {
    plans.push({ propId: 'chest', slot: 'center' });
  }
  if (plans.length === 0 && furnishings === 'full') {
    for (const id of MOTIF_AMBIENT[motif].slice(0, 2)) {
      plans.push({ propId: id, slot: id === 'torch' ? 'edge' : 'corner' });
    }
  }
  const seen = new Set<string>();
  const cap = furnishings === 'light' ? 2 : 4;
  return withoutDoorwayProps(plans).filter((p) => {
    if (seen.has(p.propId)) return false;
    seen.add(p.propId);
    return Boolean(propDef(p.propId));
  }).slice(0, cap);
}

function floorCells(room: DungeonRoom, cols: number, rows: number, floor: Uint8Array): Array<{ col: number; row: number }> {
  const cells: Array<{ col: number; row: number }> = [];
  for (let row = room.y; row < room.y + room.h; row++) {
    for (let col = room.x; col < room.x + room.w; col++) {
      if (col < 0 || row < 0 || col >= cols || row >= rows) continue;
      if (floor[row * cols + col] !== 1) continue;
      cells.push({ col, row });
    }
  }
  return cells;
}

function pickCell(
  rnd: () => number,
  cells: Array<{ col: number; row: number }>,
  room: DungeonRoom,
  slot: SpawnSlot,
  used: Set<string>,
): { col: number; row: number } | null {
  if (cells.length === 0) return null;
  const cx = room.x + room.w / 2;
  const cy = room.y + room.h / 2;
  const scored = cells
    .map((c) => {
      const dx = c.col + 0.5 - cx;
      const dy = c.row + 0.5 - cy;
      const dist = Math.hypot(dx, dy);
      const edgeDist = Math.min(
        c.col - room.x,
        c.row - room.y,
        room.x + room.w - 1 - c.col,
        room.y + room.h - 1 - c.row,
      );
      let score = dist;
      if (slot === 'edge') score = -edgeDist + dist * 0.15;
      if (slot === 'corner') score = -edgeDist * 1.2 + dist * 0.05;
      if (slot === 'center') score = dist;
      return { c, score, key: `${c.col},${c.row}` };
    })
    .filter((s) => !used.has(s.key))
    .sort((a, b) => a.score - b.score);
  if (scored.length === 0) return null;
  const pick = scored[Math.min(scored.length - 1, Math.floor(rnd() * Math.min(3, scored.length)))]!;
  used.add(pick.key);
  return pick.c;
}

function stairCells(stairs: DungeonStair[]): Set<string> {
  const s = new Set<string>();
  for (const st of stairs) s.add(`${st.x},${st.y}`);
  return s;
}

function cellToItem(
  map: MapItem,
  cell: number,
  col: number,
  row: number,
  propId: string,
  name: string,
  imageUrl: string,
  scale = 1,
): ImageItem {
  const size = cell * scale;
  const lx = col * cell + (cell - size) / 2;
  const ly = row * cell + (cell - size) / 2;
  return {
    id: uuidv4(),
    type: 'image',
    name,
    imageUrl,
    propId,
    propState: 0,
    propNeedsDmApprove: true,
    x: map.x + lx,
    y: map.y + ly,
    rotation: 0,
    width: size,
    height: size,
    zIndex: itemZ(col, row),
    locked: true,
    visible: true,
    dungeonPropForMapId: map.id,
    propMapLocalX: lx,
    propMapLocalY: ly,
    propMapLocalRotation: 0,
  };
}

function itemZ(col: number, row: number): number {
  return 2 + (col + row) * 0.001;
}

function spawnStairProps(map: MapItem, dungeon: GeneratedDungeon, used: Set<string>): ImageItem[] {
  const out: ImageItem[] = [];
  for (const stair of dungeon.stairs) {
    const key = `${stair.x},${stair.y}`;
    if (used.has(key)) continue;
    used.add(key);
    const propId = stair.direction === 'up' ? 'stairs-up' : 'stairs-down';
    const def = propDef(propId);
    if (!def) continue;
    out.push(cellToItem(map, dungeon.cell, stair.x, stair.y, propId, def.name, def.imageUrl, 1.05));
  }
  return out;
}

/** 3D-capable props from generator room notes — placed on matching grid cells. */
export function buildDungeonPropItems(
  map: MapItem,
  dungeon: GeneratedDungeon,
  opts?: { furnishings?: FurnishingStyle },
): ImageItem[] {
  const furnishings = opts?.furnishings
    ?? map.dungeon?.options.furnishings
    ?? 'full';
  if (furnishings === 'none') return spawnStairProps(map, dungeon, stairCells(dungeon.stairs));

  const rnd = mulberry32((dungeon.keyText.length * 997 + map.x * 13 + map.y * 17) >>> 0);
  const used = stairCells(dungeon.stairs);
  const items: ImageItem[] = spawnStairProps(map, dungeon, used);

  for (const room of dungeon.rooms) {
    const plans = plansFromRoom(room, dungeon.motif, furnishings);
    const cells = floorCells(room, dungeon.cols, dungeon.rows, dungeon.floor).filter(
      (c) => !used.has(`${c.col},${c.row}`),
    );
    if (cells.length === 0) continue;

    for (const plan of plans) {
      const def = propDef(plan.propId);
      if (!def) continue;
      const cell = pickCell(rnd, cells, room, plan.slot, used);
      if (!cell) continue;
      items.push(
        cellToItem(
          map,
          dungeon.cell,
          cell.col,
          cell.row,
          def.id,
          def.name,
          def.imageUrl,
          plan.scale ?? 1,
        ),
      );
    }
  }

  return items;
}
