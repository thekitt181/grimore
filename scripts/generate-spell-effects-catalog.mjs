/**
 * Builds apps/client/src/systems/spells/spellEffectsCatalog.ts from Embers effect_record.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const EFFECT_JSON = process.env.EMBERS_EFFECT_JSON
  ?? path.join(process.env.USERPROFILE ?? '', '.cursor/projects/c-Users-Admin-Desktop/agent-tools/4785ac42-e839-4870-a14a-1f0234999497.txt');
const OUT = path.join(ROOT, 'apps/client/src/systems/spells/spellEffectsCatalog.ts');

const SKIP = new Set(['generic', 'sneak_attack', 'bardic_inspiration']);

const DEFAULT_AOE = {
  antilife_shell: { size: 10, type: 'radius' },
  arms_of_hadar: { size: 10, type: 'radius' },
  black_tentacles: { size: 20, type: 'radius' },
  burning_hands: { size: 15, type: 'cone' },
  call_lightning: { size: 60, type: 'radius' },
  cloud_of_daggers: { size: 5, type: 'radius' },
  cone_of_cold: { size: 60, type: 'cone' },
  darkness: { size: 15, type: 'radius' },
  detect_magic: { size: 30, type: 'radius' },
  entangle: { size: 20, type: 'radius' },
  fireball: { size: 20, type: 'radius' },
  flaming_sphere: { size: 10, type: 'radius' },
  fog_cloud: { size: 20, type: 'radius' },
  grease: { size: 10, type: 'radius' },
  gust_of_wind: { size: 60, type: 'line' },
  lightning_bolt: { size: 100, type: 'line' },
  moonbeam: { size: 5, type: 'radius' },
  shatter: { size: 10, type: 'radius' },
  sleet_storm: { size: 40, type: 'radius' },
  spirit_guardians: { size: 15, type: 'radius' },
  thunderwave: { size: 15, type: 'cube' },
  wall_of_fire: { size: 60, type: 'line' },
  wall_of_force: { size: 10, type: 'cube' },
  web: { size: 20, type: 'radius' },
  whirlwind: { size: 30, type: 'radius' },
  wind_wall: { size: 50, type: 'line' },
};

const SELF_KEYS = new Set([
  'arcane_hand', 'bless', 'dancing_lights', 'detect_magic', 'hunters_mark',
  'misty_step', 'sacred_flame', 'shield', 'spiritual_weapon', 'toll_the_dead',
]);

const MELEE_KEYS = new Set(['cure_wounds', 'divine_smite']);

const ZONE_KEYS = new Set([
  'antilife_shell', 'black_tentacles', 'call_lightning', 'cloud_of_daggers',
  'darkness', 'detect_magic', 'entangle', 'flaming_sphere', 'fog_cloud',
  'grease', 'moonbeam', 'spirit_guardians', 'sleet_storm', 'web', 'whirlwind',
  'wind_wall', 'wall_of_fire', 'wall_of_force', 'arms_of_hadar',
]);

const CONCENTRATION_KEYS = new Set([
  'antilife_shell', 'black_tentacles', 'call_lightning', 'cloud_of_daggers',
  'darkness', 'detect_magic', 'entangle', 'flaming_sphere', 'fog_cloud',
  'hunters_mark', 'moonbeam', 'spirit_guardians', 'sleet_storm', 'web',
  'witch_bolt', 'wind_wall', 'wall_of_fire',
]);

function titleCase(key) {
  return key.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function isEffect(o) {
  return o && typeof o.basename === 'string' && typeof o.type === 'string' && o.variants;
}

function pickEffect(obj, trail = '') {
  if (isEffect(obj)) return { trail, ...obj };
  for (const k of Object.keys(obj ?? {})) {
    const r = pickEffect(obj[k], trail ? `${trail}.${k}` : k);
    if (r) return r;
  }
  return null;
}

function maxTargetsFor(key, mode) {
  if (mode !== 'melee' && mode !== 'ranged') return 0;
  if (key === 'magic_missile' || key === 'scorching_ray') return 3;
  if (key === 'chain_lightning') return 4;
  return 1;
}

function castMode(key, embersType) {
  if (MELEE_KEYS.has(key)) return 'melee';
  if (key === 'fireball') return 'aoe';
  if (embersType === 'TARGET') return 'ranged';
  if (embersType === 'CONE' || embersType === 'WALL') return 'aoe';
  if (SELF_KEYS.has(key)) return 'self';
  if (embersType === 'CIRCLE') return 'aoe';
  return 'self';
}

function pickVariant(asset) {
  const keys = Object.keys(asset.variants ?? {}).map(Number).filter((n) => !Number.isNaN(n));
  keys.sort((a, b) => a - b);
  const key = String(keys[Math.floor(keys.length / 2)] ?? keys[0] ?? '400');
  const v = asset.variants[key];
  const suffix = v.name?.[0] ?? `${v.size?.[0]}x${v.size?.[1]}`;
  return {
    variantKey: key,
    suffix,
    width: v.size?.[0] ?? 400,
    height: v.size?.[1] ?? 400,
    durationMs: v.duration?.[0] ?? 3000,
  };
}

const raw = JSON.parse(fs.readFileSync(EFFECT_JSON, 'utf8'));
const entries = [];

for (const key of Object.keys(raw).sort()) {
  if (SKIP.has(key)) continue;
  const fx = pickEffect(raw[key], key);
  if (!fx) continue;
  const variant = pickVariant(fx);
  const mode = castMode(key, fx.type);
  const aoe = DEFAULT_AOE[key];
  const directed = fx.type === 'CONE' || fx.type === 'WALL' || fx.type === 'TARGET';

  entries.push({
    id: key,
    name: titleCase(key),
    castMode: mode,
    embersType: fx.type,
    concentration: CONCENTRATION_KEYS.has(key),
    hasZoneLoop: ZONE_KEYS.has(key),
    maxTargets: maxTargetsFor(key, mode),
    jb2a: {
      basename: fx.basename,
      dpi: fx.dpi ?? 200,
      directed,
      variantKey: variant.variantKey,
      suffix: variant.suffix,
      width: variant.width,
      height: variant.height,
      durationMs: variant.durationMs,
    },
    ...(aoe ? { aoe } : {}),
  });
}

const header = `/** Auto-generated by scripts/generate-spell-effects-catalog.mjs — do not edit by hand. */

import type { ActiveSpellEffect } from '@grimoire/shared';
import type { Jb2aEffectAsset } from './jb2aAssets';

export type SpellCastMode = 'aoe' | 'ranged' | 'self' | 'melee';

export interface CatalogJb2aAsset {
  basename: string;
  dpi: number;
  directed: boolean;
  variantKey: string;
  suffix: string;
  width: number;
  height: number;
  durationMs: number;
}

export interface SpellEffectCatalogEntry {
  id: string;
  name: string;
  castMode: SpellCastMode;
  embersType: 'CIRCLE' | 'CONE' | 'TARGET' | 'WALL';
  concentration: boolean;
  hasZoneLoop: boolean;
  /** Token clicks required on map (0 = none). */
  maxTargets: number;
  jb2a: CatalogJb2aAsset;
  aoe?: { size: number; type: string };
}

export const SPELL_EFFECTS_CATALOG: SpellEffectCatalogEntry[] = `;

const body = JSON.stringify(entries, null, 2)
  .replace(/"castMode": "([^"]+)"/g, '"castMode": "$1" as SpellCastMode')
  .replace(/"embersType": "([^"]+)"/g, '"embersType": "$1"');

const footer = `;

export const SPELL_EFFECTS_BY_ID = Object.fromEntries(
  SPELL_EFFECTS_CATALOG.map((e) => [e.id, e]),
) as Record<string, SpellEffectCatalogEntry>;

export const SPELL_EFFECTS_BY_NAME = Object.fromEntries(
  SPELL_EFFECTS_CATALOG.map((e) => [e.name.toLowerCase(), e]),
) as Record<string, SpellEffectCatalogEntry>;

export function findSpellEffectCatalogEntry(spellName: string): SpellEffectCatalogEntry | undefined {
  const key = spellName.trim().toLowerCase().replace(/\\s+/g, ' ');
  if (SPELL_EFFECTS_BY_NAME[key]) return SPELL_EFFECTS_BY_NAME[key];
  const id = key.replace(/\\s+/g, '_');
  return SPELL_EFFECTS_BY_ID[id];
}

export function effectShowsMapZone(effect: ActiveSpellEffect): boolean {
  const catalog = findSpellEffectCatalogEntry(effect.spellName);
  if (!catalog) return false;
  return catalog.hasZoneLoop || catalog.concentration;
}

export function catalogEntryToJb2aAsset(entry: SpellEffectCatalogEntry): Jb2aEffectAsset {
  const { basename, dpi, directed, suffix, width, height, variantKey } = entry.jb2a;
  return {
    basename,
    dpi,
    ...(directed ? { directed: true } : {}),
    variants: {
      [variantKey]: { suffix, width, height, durationMs: entry.jb2a.durationMs },
    },
  };
}
`;

fs.writeFileSync(OUT, header + body + footer);
console.log(`Wrote ${entries.length} spells to ${OUT}`);
