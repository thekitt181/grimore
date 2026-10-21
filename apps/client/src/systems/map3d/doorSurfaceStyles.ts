/**
 * Door / gate palettes for 2D props and 3D meshes — pairs with dungeon wall motifs.
 */

export type DoorStyleId =
  | 'mixed'
  | 'crypt'
  | 'temple'
  | 'fortress'
  | 'mine'
  | 'ruin'
  | 'clay'
  | 'iron'
  | 'oak'
  | 'wood-pine'
  | 'wood-walnut'
  | 'wood-rotten'
  | 'metal-steel'
  | 'metal-rust'
  | 'barred-iron'
  | 'barred-rust'
  | 'barred-oak'
  | 'barred-cell'
  | 'bronze'
  | 'obsidian'
  | 'sandstone'
  | 'elven'
  | 'dwarven'
  | 'bone'
  | 'fel';

export interface DoorSurfaceStyle {
  id: DoorStyleId;
  label: string;
  panel: string;
  panelDark: string;
  trim: string;
  handle: string;
  rune: string;
  /** GM hidden secret — flush with extruded walls */
  conceal: string;
  gate: string;
  gateDark: string;
}

export const DOOR_SURFACE_STYLES: Record<DoorStyleId, DoorSurfaceStyle> = {
  mixed: {
    id: 'mixed',
    label: 'Mixed stone',
    panel: '#6b5a48',
    panelDark: '#4a3d30',
    trim: '#8a7a68',
    handle: '#c9a84c',
    rune: '#9b7dff',
    conceal: '#5c554c',
    gate: '#6a6a70',
    gateDark: '#3a3a40',
  },
  crypt: {
    id: 'crypt',
    label: 'Crypt',
    panel: '#4a524e',
    panelDark: '#2a302e',
    trim: '#6a726e',
    handle: '#a8a090',
    rune: '#88ccaa',
    conceal: '#4e5854',
    gate: '#5a6260',
    gateDark: '#2e3432',
  },
  temple: {
    id: 'temple',
    label: 'Temple',
    panel: '#7a7058',
    panelDark: '#4a4438',
    trim: '#c9a84c',
    handle: '#e8dcc0',
    rune: '#ffe566',
    conceal: '#6e6452',
    gate: '#8a8070',
    gateDark: '#4a4438',
  },
  fortress: {
    id: 'fortress',
    label: 'Fortress',
    panel: '#686860',
    panelDark: '#3a3a38',
    trim: '#9a9a96',
    handle: '#b8b8b4',
    rune: '#7ab0ff',
    conceal: '#585856',
    gate: '#707078',
    gateDark: '#383840',
  },
  mine: {
    id: 'mine',
    label: 'Mine',
    panel: '#6a6258',
    panelDark: '#3c3630',
    trim: '#8a8278',
    handle: '#a89070',
    rune: '#ffaa44',
    conceal: '#5a544c',
    gate: '#6a6660',
    gateDark: '#3c3834',
  },
  ruin: {
    id: 'ruin',
    label: 'Ruin',
    panel: '#7a6048',
    panelDark: '#4a3828',
    trim: '#a08868',
    handle: '#c9a070',
    rune: '#dd8866',
    conceal: '#625040',
    gate: '#7a6858',
    gateDark: '#443830',
  },
  clay: {
    id: 'clay',
    label: 'Clay brick',
    panel: '#9a9088',
    panelDark: '#6e6a64',
    trim: '#b8b0a8',
    handle: '#8a8075',
    rune: '#c9a84c',
    conceal: '#8c8880',
    gate: '#8a8680',
    gateDark: '#5c5954',
  },
  iron: {
    id: 'iron',
    label: 'Iron bound',
    panel: '#4a4a52',
    panelDark: '#2a2a30',
    trim: '#6a6a72',
    handle: '#909098',
    rune: '#88bbff',
    conceal: '#484850',
    gate: '#5a5a62',
    gateDark: '#2e2e34',
  },
  oak: {
    id: 'oak',
    label: 'Heavy oak',
    panel: '#6b4423',
    panelDark: '#3d2412',
    trim: '#8b5a2b',
    handle: '#c9a84c',
    rune: '#88ffaa',
    conceal: '#5a4030',
    gate: '#5a4030',
    gateDark: '#3d2412',
  },
  'wood-pine': {
    id: 'wood-pine',
    label: 'Pine planks',
    panel: '#7a6848',
    panelDark: '#4a4030',
    trim: '#9a8868',
    handle: '#c9a84c',
    rune: '#aaffcc',
    conceal: '#6a5840',
    gate: '#6a5840',
    gateDark: '#4a4030',
  },
  'wood-walnut': {
    id: 'wood-walnut',
    label: 'Dark walnut',
    panel: '#4a3828',
    panelDark: '#2a2018',
    trim: '#6a5848',
    handle: '#c9a84c',
    rune: '#88ccaa',
    conceal: '#3a3028',
    gate: '#4a3828',
    gateDark: '#2a2018',
  },
  'wood-rotten': {
    id: 'wood-rotten',
    label: 'Rotten wood',
    panel: '#5a5040',
    panelDark: '#3a3428',
    trim: '#6a6050',
    handle: '#8a8070',
    rune: '#aa8866',
    conceal: '#4a4438',
    gate: '#5a5040',
    gateDark: '#3a3428',
  },
  'metal-steel': {
    id: 'metal-steel',
    label: 'Steel plate',
    panel: '#5a5a62',
    panelDark: '#3a3a42',
    trim: '#8a8a92',
    handle: '#b0b0b8',
    rune: '#88bbff',
    conceal: '#484850',
    gate: '#686870',
    gateDark: '#383840',
  },
  'metal-rust': {
    id: 'metal-rust',
    label: 'Rusted iron',
    panel: '#6a5040',
    panelDark: '#4a3828',
    trim: '#8a6858',
    handle: '#a89078',
    rune: '#ff8844',
    conceal: '#5a4838',
    gate: '#7a5848',
    gateDark: '#4a3828',
  },
  'barred-iron': {
    id: 'barred-iron',
    label: 'Barred — iron',
    panel: '#4a4a52',
    panelDark: '#2a2a30',
    trim: '#7a7a82',
    handle: '#909098',
    rune: '#88bbff',
    conceal: '#484850',
    gate: '#5a5a62',
    gateDark: '#2e2e34',
  },
  'barred-rust': {
    id: 'barred-rust',
    label: 'Barred — rust',
    panel: '#6a5040',
    panelDark: '#4a3828',
    trim: '#8a6858',
    handle: '#a89078',
    rune: '#ff8844',
    conceal: '#5a4838',
    gate: '#7a5848',
    gateDark: '#4a3828',
  },
  'barred-oak': {
    id: 'barred-oak',
    label: 'Barred — oak',
    panel: '#6b4423',
    panelDark: '#3d2412',
    trim: '#8b5a2b',
    handle: '#c9a84c',
    rune: '#88ffaa',
    conceal: '#5a4030',
    gate: '#5a4030',
    gateDark: '#3d2412',
  },
  'barred-cell': {
    id: 'barred-cell',
    label: 'Barred — jail cell',
    panel: '#505058',
    panelDark: '#303038',
    trim: '#707078',
    handle: '#888890',
    rune: '#aaaacc',
    conceal: '#484850',
    gate: '#606068',
    gateDark: '#383840',
  },
  bronze: {
    id: 'bronze',
    label: 'Bronze vault',
    panel: '#6a5840',
    panelDark: '#3a3020',
    trim: '#c9a84c',
    handle: '#e8c870',
    rune: '#ffcc66',
    conceal: '#5a4838',
    gate: '#8a7048',
    gateDark: '#4a3828',
  },
  obsidian: {
    id: 'obsidian',
    label: 'Obsidian',
    panel: '#2a2830',
    panelDark: '#121018',
    trim: '#4a4858',
    handle: '#9090a8',
    rune: '#cc66ff',
    conceal: '#2a2830',
    gate: '#3a3848',
    gateDark: '#181820',
  },
  sandstone: {
    id: 'sandstone',
    label: 'Sandstone',
    panel: '#c4a574',
    panelDark: '#9a8058',
    trim: '#e8d8b0',
    handle: '#a89060',
    rune: '#ff8844',
    conceal: '#b09870',
    gate: '#a89070',
    gateDark: '#786850',
  },
  elven: {
    id: 'elven',
    label: 'Elven marble',
    panel: '#d8e8e4',
    panelDark: '#a8b8b4',
    trim: '#f0ffff',
    handle: '#c9a84c',
    rune: '#66ffcc',
    conceal: '#c0d0cc',
    gate: '#b0c0bc',
    gateDark: '#809088',
  },
  dwarven: {
    id: 'dwarven',
    label: 'Dwarven granite',
    panel: '#585860',
    panelDark: '#303038',
    trim: '#909098',
    handle: '#c9a84c',
    rune: '#ffaa22',
    conceal: '#505058',
    gate: '#686870',
    gateDark: '#383840',
  },
  bone: {
    id: 'bone',
    label: 'Bone & ash',
    panel: '#d8d0c0',
    panelDark: '#a8a090',
    trim: '#f0ece0',
    handle: '#908878',
    rune: '#88ff88',
    conceal: '#c8c0b0',
    gate: '#b0a898',
    gateDark: '#807870',
  },
  fel: {
    id: 'fel',
    label: 'Fel corrupted',
    panel: '#4a3848',
    panelDark: '#281820',
    trim: '#6a5070',
    handle: '#a06090',
    rune: '#ff44aa',
    conceal: '#3a2838',
    gate: '#584858',
    gateDark: '#302030',
  },
};

export const DOOR_SURFACE_STYLE_OPTIONS: DoorSurfaceStyle[] = Object.values(DOOR_SURFACE_STYLES);

/** Grouped door art for toolbar / inspector (material family → sub-themes). */
export const DOOR_STYLE_GROUPS: { label: string; ids: DoorStyleId[] }[] = [
  {
    label: 'Stone (matches Wall art)',
    ids: ['mixed', 'crypt', 'temple', 'fortress', 'mine', 'ruin', 'clay', 'sandstone'],
  },
  {
    label: 'Wood doors',
    ids: ['oak', 'wood-pine', 'wood-walnut', 'wood-rotten', 'elven'],
  },
  {
    label: 'Metal doors',
    ids: ['iron', 'metal-steel', 'metal-rust', 'bronze', 'dwarven'],
  },
  {
    label: 'Barred doors',
    ids: ['barred-iron', 'barred-rust', 'barred-oak', 'barred-cell'],
  },
  {
    label: 'Arcane / special',
    ids: ['obsidian', 'bone', 'fel'],
  },
];

export function isDoorStyleId(id: unknown): id is DoorStyleId {
  return typeof id === 'string' && id in DOOR_SURFACE_STYLES;
}

export function resolveDoorSurfaceStyle(id: string | undefined | null): DoorSurfaceStyle {
  if (id && id in DOOR_SURFACE_STYLES) {
    return DOOR_SURFACE_STYLES[id as DoorStyleId];
  }
  return DOOR_SURFACE_STYLES.mixed;
}

/** Motif from dungeon generator → default door theme */
export function doorStyleForMotif(motif: string | undefined): DoorStyleId {
  if (isDoorStyleId(motif)) return motif;
  return 'mixed';
}
