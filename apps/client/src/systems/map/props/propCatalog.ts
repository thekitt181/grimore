import { hasPropModel3D } from '@/systems/map3d/propModels3d';
import {
  PROP_ART,
  type PropArt,
  canonicalPropId,
  propArtByIdBase,
} from './propArt';

/** Props registered at runtime when notes / spawn reference an id not in the base list. */
const EXTRA_PROP_ART: PropArt[] = [];

const registered = new Set<string>();

function slugId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function titleCase(id: string): string {
  return id
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Common note / key wording → catalog id (before asset discovery). */
const PHRASE_TO_ID: Array<{ test: RegExp; id: string }> = [
  { test: /\bportcullis\b/i, id: 'gate' },
  { test: /\bpressure plate\b/i, id: 'plate' },
  { test: /\btripwire\b/i, id: 'tripwire' },
  { test: /\bglyph cut into the floor\b|\bfloor glyph\b/i, id: 'floor-glyph' },
  { test: /\bswarm roosting\b|\broosting overhead\b/i, id: 'swarm' },
  { test: /\bempty cage\b|\ban empty cage\b/i, id: 'cage' },
  { test: /\bfaded mural\b|\bmural\b/i, id: 'mural' },
  { test: /\bart object\b|\bfigurine\b|\bstatuette\b/i, id: 'art-object' },
  { test: /\barrow trap\b|\bmurder hole\b|\barrow slit\b/i, id: 'arrows' },
  { test: /\bdart trap\b|\bdarts\b/i, id: 'dart' },
  { test: /\bbolt trap\b/i, id: 'bolt' },
  { test: /\baxe trap\b/i, id: 'axe' },
  { test: /\bnet trap\b/i, id: 'net' },
  { test: /\balarm trap\b|\bbell rope\b/i, id: 'alarm' },
  { test: /\bteleport trap\b/i, id: 'teleport' },
  { test: /\bsarcophagus\b|\btomb\b/i, id: 'sarcophagus' },
  { test: /\bcanopic\b/i, id: 'potion' },
  { test: /\breliquary\b|\bfont\b/i, id: 'altar' },
  { test: /\bweapon racks?\b|\bspare weapons\b|\brack of weapons\b/i, id: 'weapon-rack' },
  { test: /\boffering coins\b|\bcoins\b|\bfuneral coins\b/i, id: 'coins' },
  { test: /\blocked chest\b|\bstrongbox\b|\bstash\b|\bpay chest\b/i, id: 'chest' },
  { test: /\bscroll case\b|\bspellbook\b|\bprayer book\b/i, id: 'book' },
  { test: /\bsealed scroll\b|\bscroll\b/i, id: 'scroll' },
  { test: /\bsignet\b|\blocked\b/i, id: 'ring' },
  { test: /\bkeys?\b/i, id: 'key' },
  { test: /\bbarrel\b|\bkeg\b/i, id: 'barrel' },
  { test: /\bcrate\b|\brations\b/i, id: 'crate' },
  { test: /\btimber prop\b|\bbroken picks\b/i, id: 'column' },
  { test: /\bore cart\b|\bcart rails\b/i, id: 'crate' },
  { test: /\buncut gem\b|\bclaim token\b|\bore\b/i, id: 'coins' },
  { test: /\bgrate\b/i, id: 'grate' },
  { test: /\bwell\b|\bpool\b|\bfont chamber\b/i, id: 'dry-fountain' },
  { test: /\bportal\b/i, id: 'portal' },
  { test: /\barch\b/i, id: 'arch' },
  { test: /\bladder\b|\bshaft\b/i, id: 'ladder' },
  { test: /\bidol\b|\bkneeling figure\b/i, id: 'idol' },
  { test: /\bangel\b|\bsaint\b/i, id: 'angel' },
  { test: /\bfungus\b|\bmoss\b|\bmold\b|\bivy\b/i, id: 'mold' },
  { test: /\bcorpse\b|\bgrave dust\b/i, id: 'corpse' },
  { test: /\bskeleton\b|\bbones\b/i, id: 'skeleton' },
  { test: /\bskull\b/i, id: 'skull' },
  { test: /\bcampfire\b|\bhearth\b|\bcold hearth\b/i, id: 'campfire' },
  { test: /\btorch\b|\bsconce\b|\bcandle\b/i, id: 'torch' },
];

function restCandidates(id: string): string[] {
  const dash = id;
  const nodash = id.replace(/-/g, '');
  return [
    `/props/${dash}.png`,
    `/props/${dash}-closed.png`,
    `/props/${dash}-trap.png`,
    `/props/${nodash}.png`,
    `/props/${dash.replace(/-door$/, '-closed')}.png`,
    `/props/gold.png`,
    `/props/crate.png`,
    `/props/boulder.png`,
  ];
}

function guessArt(id: string): PropArt | null {
  const key = canonicalPropId(id);
  const existing = propArtByIdBase(key);
  if (existing) return existing;

  let rest = restCandidates(key).find((p) => !p.includes('undefined')) ?? `/props/crate.png`;
  if (key.endsWith('-door') || key === 'door') {
    rest = '/props/door-closed.png';
  }
  if (key === 'gate' || key === 'portcullis') {
    rest = '/props/gate-closed.png';
  }

  const toggleDoors = new Set(['door', 'runed-door', 'secret-door', 'gate', 'hatch', 'shop']);
  const traps = new Set(['arrows', 'dart', 'bolt', 'spear', 'blade', 'axe', 'net', 'alarm', 'teleport']);
  const motion: PropArt['motion'] =
    traps.has(key) ? 'fire' : toggleDoors.has(key) ? 'toggle' : key === 'torch' || key === 'campfire' ? 'loop' : 'none';
  const play: PropArt['play'] =
    motion === 'fire' ? 'shoot' : motion === 'toggle' ? 'swing' : motion === 'loop' ? 'flicker' : 'still';

  const open =
    toggleDoors.has(key) && key !== 'hatch'
      ? key === 'gate'
        ? '/props/gate-open.png'
        : '/props/door-open.png'
      : key === 'hatch'
        ? '/props/shaft.png'
        : undefined;

  const hasKnownSprite =
    rest !== '/props/crate.png'
    || toggleDoors.has(key)
    || traps.has(key)
    || hasPropModel3D(key);
  if (!hasKnownSprite) return null;

  return {
    id: key,
    name: titleCase(key),
    short: titleCase(key).slice(0, 8),
    motion,
    play,
    rest,
    ...(open ? { open } : {}),
  };
}

function pushExtra(art: PropArt): PropArt {
  if (registered.has(art.id)) {
    return EXTRA_PROP_ART.find((p) => p.id === art.id) ?? art;
  }
  registered.add(art.id);
  EXTRA_PROP_ART.push(art);
  return art;
}

export function allPropArtEntries(): PropArt[] {
  return [...PROP_ART, ...EXTRA_PROP_ART];
}

export function propArtById(id: string): PropArt | undefined {
  const key = canonicalPropId(id);
  const base = propArtByIdBase(key) ?? EXTRA_PROP_ART.find((p) => p.id === key);
  if (base) return base;
  const discovered = guessArt(key);
  return discovered ? pushExtra(discovered) : undefined;
}

export function propArtByName(name: string): PropArt | undefined {
  const trimmed = name.trim();
  if (!trimmed) return undefined;
  const lower = trimmed.toLowerCase();
  for (const art of allPropArtEntries()) {
    if (
      art.id === lower
      || art.name.toLowerCase() === lower
      || art.short.toLowerCase() === lower
    ) {
      return art;
    }
  }
  const slug = slugId(trimmed);
  return propArtById(slug);
}

/** Resolve id or display name; register a catalog entry from assets when missing. */
export function ensurePropCatalogEntry(idOrName: string): PropArt | undefined {
  const raw = idOrName.trim();
  if (!raw) return undefined;

  const byId = propArtById(raw);
  if (byId) return byId;

  const byName = propArtByName(raw);
  if (byName) return byName;

  const slug = slugId(raw);
  if (slug) {
    const bySlug = propArtById(slug);
    if (bySlug) return bySlug;
  }

  for (const rule of PHRASE_TO_ID) {
    if (!rule.test.test(raw)) continue;
    const hit = propArtById(rule.id);
    if (hit) return hit;
  }

  return undefined;
}

/** Extract prop ids referenced in dungeon note / key text. */
export function propIdsFromNoteText(text: string): string[] {
  const ids = new Set<string>();
  for (const rule of PHRASE_TO_ID) {
    if (rule.test.test(text)) {
      const art = ensurePropCatalogEntry(rule.id);
      if (art) ids.add(art.id);
    }
  }
  return [...ids];
}
