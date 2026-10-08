export type PropMotion = 'none' | 'toggle' | 'fire' | 'loop';

export type PropPlay =
  | 'still'
  | 'lift'
  | 'split'
  | 'rise'
  | 'drop'
  | 'press'
  | 'snap'
  | 'shoot'
  | 'flicker'
  | 'ignite'
  | 'swing'
  | 'flow'
  | 'spread'
  | 'swap'
  | 'burst'
  | 'pulse'
  | 'breathe';

export interface PropArt {
  id: string;
  name: string;
  short: string;
  motion: PropMotion;
  play: PropPlay;
  rest: string;
  open?: string;
  frames?: string[];
  projectile?: string;
}

const torch = [0, 1, 2, 3, 4].map((i) => `/props/torch-${i}.png`);
const flame = [0, 1, 2].map((i) => `/props/flame-${i}.png`);
const fountain = [0, 1].map((i) => `/props/fountain-${i}.png`);
const bloodFountain = [0, 1].map((i) => `/props/blood-fountain-${i}.png`);
const mold = ['/props/mold.png', '/props/mold-1.png', '/props/mold-2.png', '/props/mold-3.png'];

/** Real Dungeon Crawl sprites. Ids stay stable so props already on a map keep working. */
export const PROP_ART: PropArt[] = [
  { id: 'chest', name: 'Chest', short: 'Chest', motion: 'toggle', play: 'lift', rest: '/props/chest-closed.png', open: '/props/chest-open.png' },
  { id: 'sarcophagus', name: 'Sarcophagus', short: 'Tomb', motion: 'toggle', play: 'lift', rest: '/props/sarcophagus-closed.png', open: '/props/sarcophagus-open.png' },
  { id: 'coins', name: 'Coins', short: 'Coins', motion: 'none', play: 'still', rest: '/props/gold.png' },
  { id: 'bone', name: 'Bone', short: 'Bone', motion: 'none', play: 'still', rest: '/props/bone.png' },
  { id: 'skeleton', name: 'Skeleton', short: 'Bones', motion: 'none', play: 'still', rest: '/props/skeleton.png' },
  { id: 'skull', name: 'Skull', short: 'Skull', motion: 'none', play: 'still', rest: '/props/skull.png' },
  { id: 'corpse', name: 'Corpse', short: 'Corpse', motion: 'none', play: 'still', rest: '/props/corpse.png' },
  { id: 'crate', name: 'Crate', short: 'Crate', motion: 'none', play: 'still', rest: '/props/crate.png' },
  { id: 'boulder', name: 'Boulder', short: 'Rock', motion: 'none', play: 'still', rest: '/props/boulder.png' },
  { id: 'column', name: 'Column', short: 'Pillar', motion: 'none', play: 'still', rest: '/props/column.png' },
  { id: 'statue', name: 'Statue', short: 'Statue', motion: 'toggle', play: 'swap', rest: '/props/statue.png', open: '/props/stump.png' },
  { id: 'altar', name: 'Altar', short: 'Altar', motion: 'toggle', play: 'ignite', rest: '/props/altar.png', frames: flame },
  { id: 'torch', name: 'Torch', short: 'Torch', motion: 'loop', play: 'flicker', rest: torch[0]!, frames: torch },
  { id: 'campfire', name: 'Campfire', short: 'Fire', motion: 'loop', play: 'flicker', rest: flame[0]!, frames: flame },
  { id: 'door', name: 'Door', short: 'Door', motion: 'toggle', play: 'swing', rest: '/props/door-closed.png', open: '/props/door-open.png' },
  { id: 'hatch', name: 'Trap door', short: 'Hatch', motion: 'toggle', play: 'split', rest: '/props/hatch.png', open: '/props/shaft.png' },
  { id: 'arrows', name: 'Arrow trap', short: 'Arrows', motion: 'fire', play: 'shoot', rest: '/props/arrow-trap.png', projectile: '/props/arrow.png' },
  { id: 'spear', name: 'Spear trap', short: 'Spear', motion: 'toggle', play: 'rise', rest: '/props/spear-trap.png' },
  { id: 'blade', name: 'Blade trap', short: 'Blade', motion: 'toggle', play: 'snap', rest: '/props/blade-trap.png' },
  { id: 'plate', name: 'Pressure plate', short: 'Plate', motion: 'toggle', play: 'press', rest: '/props/plate.png' },
  { id: 'gate', name: 'Portcullis', short: 'Gate', motion: 'toggle', play: 'drop', rest: '/props/gate-closed.png', open: '/props/gate-open.png' },
  { id: 'runed-door', name: 'Runed door', short: 'Runed', motion: 'toggle', play: 'swing', rest: '/props/runed-door.png', open: '/props/door-open.png' },
  { id: 'secret-door', name: 'Secret door', short: 'Secret', motion: 'toggle', play: 'swing', rest: '/props/secret-door.png', open: '/props/door-open.png' },
  { id: 'stairs-down', name: 'Stairs down', short: 'Down', motion: 'toggle', play: 'swap', rest: '/props/stairs-down.png', open: '/props/stairs-down-sealed.png' },
  { id: 'stairs-up', name: 'Stairs up', short: 'Up', motion: 'toggle', play: 'swap', rest: '/props/stairs-up.png', open: '/props/stairs-up-sealed.png' },
  { id: 'ladder', name: 'Ladder', short: 'Ladder', motion: 'toggle', play: 'split', rest: '/props/ladder.png', open: '/props/shaft.png' },
  { id: 'arch', name: 'Arch', short: 'Arch', motion: 'none', play: 'still', rest: '/props/arch.png' },
  { id: 'portal', name: 'Portal', short: 'Portal', motion: 'loop', play: 'breathe', rest: '/props/portal.png' },
  { id: 'fountain', name: 'Fountain', short: 'Fountain', motion: 'loop', play: 'flicker', rest: fountain[0]!, frames: fountain },
  { id: 'blood-fountain', name: 'Blood fountain', short: 'Blood', motion: 'loop', play: 'flicker', rest: bloodFountain[0]!, frames: bloodFountain },
  { id: 'dry-fountain', name: 'Dry fountain', short: 'Dry', motion: 'toggle', play: 'flow', rest: '/props/fountain-dry.png', frames: fountain },
  { id: 'shop', name: 'Shop', short: 'Shop', motion: 'toggle', play: 'swap', rest: '/props/shop.png', open: '/props/shop-closed.png' },
  { id: 'grate', name: 'Grate', short: 'Grate', motion: 'none', play: 'still', rest: '/props/grate.png' },
  { id: 'pedestal', name: 'Pedestal', short: 'Pedestal', motion: 'none', play: 'still', rest: '/props/pedestal.png' },
  { id: 'idol', name: 'Idol', short: 'Idol', motion: 'none', play: 'still', rest: '/props/idol.png' },
  { id: 'angel', name: 'Angel statue', short: 'Angel', motion: 'none', play: 'still', rest: '/props/angel.png' },
  { id: 'mold', name: 'Fungus', short: 'Fungus', motion: 'loop', play: 'flicker', rest: mold[0]!, frames: mold },
  { id: 'mushroom', name: 'Mushroom', short: 'Shroom', motion: 'none', play: 'still', rest: '/props/mushroom.png' },
  { id: 'net', name: 'Net trap', short: 'Net', motion: 'toggle', play: 'spread', rest: '/props/net-trap.png', open: '/props/net.png' },
  { id: 'dart', name: 'Dart trap', short: 'Darts', motion: 'fire', play: 'shoot', rest: '/props/dart-trap.png', projectile: '/props/dart.png' },
  { id: 'axe', name: 'Axe trap', short: 'Axe', motion: 'toggle', play: 'snap', rest: '/props/axe-trap.png' },
  { id: 'bolt', name: 'Bolt trap', short: 'Bolt', motion: 'fire', play: 'shoot', rest: '/props/bolt-trap.png', projectile: '/props/arrow.png' },
  { id: 'alarm', name: 'Alarm trap', short: 'Alarm', motion: 'fire', play: 'burst', rest: '/props/alarm-trap.png', open: '/props/alarm-ring.png' },
  { id: 'teleport', name: 'Teleport trap', short: 'Teleport', motion: 'fire', play: 'pulse', rest: '/props/teleport-trap.png' },
  { id: 'book', name: 'Book', short: 'Book', motion: 'toggle', play: 'lift', rest: '/props/book.png', open: '/props/page.png' },
  { id: 'scroll', name: 'Scroll', short: 'Scroll', motion: 'none', play: 'still', rest: '/props/scroll.png' },
  { id: 'potion', name: 'Potion', short: 'Potion', motion: 'none', play: 'still', rest: '/props/potion.png' },
  { id: 'sword', name: 'Sword', short: 'Sword', motion: 'none', play: 'still', rest: '/props/sword.png' },
  { id: 'ring', name: 'Ring', short: 'Ring', motion: 'none', play: 'still', rest: '/props/ring.png' },
  { id: 'orb', name: 'Orb', short: 'Orb', motion: 'none', play: 'still', rest: '/props/orb.png' },
  { id: 'rune', name: 'Rune', short: 'Rune', motion: 'none', play: 'still', rest: '/props/rune.png' },
  { id: 'bread', name: 'Rations', short: 'Food', motion: 'none', play: 'still', rest: '/props/bread.png' },
];

const ALIAS: Record<string, string> = {
  'locked-chest': 'sarcophagus',
  bones: 'skeleton',
  barrel: 'crate',
  rubble: 'boulder',
  pillar: 'column',
  trapdoor: 'hatch',
  spikes: 'spear',
  'bear-trap': 'blade',
  portcullis: 'gate',
};

export function canonicalPropId(id: string): string {
  return ALIAS[id] ?? id;
}

export function propArtById(id: string): PropArt | undefined {
  const key = canonicalPropId(id);
  return PROP_ART.find((art) => art.id === key);
}
