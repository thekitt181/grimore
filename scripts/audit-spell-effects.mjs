/**
 * Semantic + URL audit for spellEffectsCatalog vs JB2A Library.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LIB = path.join(ROOT, 'apps/client/public/jb2a/Library');

const EXTRA_BEAM = new Set([
  '3rd_Level/Fireball/FireballBeam_01_Orange',
  'Cantrip/Fire_Bolt/FireBolt_01_Regular_Orange',
  'Cantrip/Eldritch_Blast/EldritchBlast_01_Regular_Purple',
  '1st_Level/Magic_Missile/MagicMissile_01_Regular_Purple',
  '2nd_Level/Scorching_Ray/ScorchingRay_01_Regular_Orange',
  '1st_Level/Witch_Bolt/WitchBolt_01_Regular_Blue',
  '1st_Level/Guiding_Bolt/GuidingBolt_01_Regular_BlueYellow',
  'Cantrip/Ray_Of_Frost/RayOfFrost_01_Regular_Blue',
  '6th_Level/Disintegrate/Disintegrate_01_Regular_Green01',
  '6th_Level/Chain_Lightning/ChainLightning_01_Regular_Blue',
]);

const NEED_IMPACT = new Set(['fireball']);
const MULTI_BEAM = new Set(['magic_missile', 'scorching_ray', 'chain_lightning']);
const INDEXED_BEAM = new Set(['magic_missile']);

// Load catalog by evaluating JSON slice
const catalogPath = path.join(ROOT, 'apps/client/src/systems/spells/spellEffectsCatalog.ts');
const src = fs.readFileSync(catalogPath, 'utf8');
const entries = [...src.matchAll(
  /"id":\s*"([^"]+)"[\s\S]*?"name":\s*"([^"]+)"[\s\S]*?"castMode":\s*"([^"]+)"[\s\S]*?"embersType":\s*"([^"]+)"[\s\S]*?"concentration":\s*(true|false)[\s\S]*?"hasZoneLoop":\s*(true|false)[\s\S]*?"maxTargets":\s*(\d+)[\s\S]*?"basename":\s*"([^"]+)"[\s\S]*?"directed":\s*(true|false)[\s\S]*?"suffix":\s*"([^"]+)"/g,
)].map((m) => ({
  id: m[1],
  name: m[2],
  castMode: m[3],
  embersType: m[4],
  concentration: m[5] === 'true',
  hasZoneLoop: m[6] === 'true',
  maxTargets: Number(m[7]),
  jb2a: { basename: m[8], directed: m[9] === 'true', suffix: m[10] },
  aoe: (() => {
    const after = src.slice(m.index, m.index + 1200);
    const size = after.match(/"aoe":\s*\{[\s\S]*?"size":\s*(\d+)[\s\S]*?"type":\s*"([^"]+)"/);
    return size ? { size: Number(size[1]), type: size[2] } : undefined;
  })(),
}));

const webmFiles = new Set();
for (const file of fs.readdirSync(LIB, { recursive: true })) {
  if (typeof file === 'string' && file.endsWith('.webm')) {
    webmFiles.add(file.replace(/\\/g, '/'));
  }
}

function fileExists(basename, suffix) {
  return webmFiles.has(`${basename}_${suffix}.webm`);
}

function listPrefix(basename) {
  return [...webmFiles].filter((f) => f.startsWith(`${basename}_`));
}

const issues = [];

for (const e of entries) {
  const { id, name, castMode, jb2a, aoe, maxTargets, hasZoneLoop, concentration } = e;
  const { basename, suffix, directed } = jb2a;

  if (!fileExists(basename, suffix)) {
    issues.push({ level: 'error', id, name, msg: `Primary asset missing: ${basename}_${suffix}.webm` });
  }

  if (NEED_IMPACT.has(id)) {
    const impactBase = '3rd_Level/Fireball/FireballExplosion_01_Orange';
    if (!fileExists(impactBase, '800x800')) {
      issues.push({ level: 'error', id, name, msg: 'Fireball impact asset missing' });
    }
  }

  if (directed && parseInt(suffix, 10) === NaN && !/\dft/i.test(suffix)) {
    const hasFtOnDisk = listPrefix(basename).some((f) => /\dft/i.test(f));
    if (hasFtOnDisk && !EXTRA_BEAM.has(basename)) {
      issues.push({
        level: 'warn',
        id,
        name,
        msg: `Directed beam has ft variants on disk but no EXTRA_BEAM_VARIANTS entry`,
      });
    }
  }

  if (INDEXED_BEAM.has(id)) {
    const hasIndexed = listPrefix(basename).some((f) => /\dft_\d{2}_/i.test(f));
    if (!hasIndexed) {
      issues.push({ level: 'warn', id, name, msg: 'Expected indexed missile variants (_01_, _02_)' });
    }
  }

  if (MULTI_BEAM.has(id) && maxTargets > 1 && !directed) {
    issues.push({ level: 'warn', id, name, msg: 'Multi-target spell but jb2a.directed=false' });
  }

  if (castMode === 'aoe' && aoe?.type === 'radius' && directed && !NEED_IMPACT.has(id) && id !== 'fireball') {
    if (basename.toLowerCase().includes('beam')) {
      issues.push({ level: 'warn', id, name, msg: 'AoE radius using beam asset without impact mapping' });
    }
  }

  if (castMode === 'ranged' && !directed) {
    issues.push({ level: 'warn', id, name, msg: 'Ranged spell should use directed beam' });
  }

  if (castMode === 'aoe' && !aoe) {
    issues.push({ level: 'warn', id, name, msg: 'AoE castMode but no aoe size in catalog' });
  }

  if (hasZoneLoop && !concentration && id !== 'grease' && id !== 'sleep') {
    // many zone loops are concentration - optional note only
  }

  // Bless intro-only check
  if (id === 'bless' && basename.includes('Intro')) {
    issues.push({
      level: 'info',
      id,
      name,
      msg: 'Uses Intro animation; zone loop may be short (acceptable)',
    });
  }

  if (id === 'divine_smite' && !basename.includes('Caster')) {
    issues.push({ level: 'warn', id, name, msg: 'Divine Smite should use Caster variant on attacker' });
  }

  if (id === 'sacred_flame' && basename.includes('Source')) {
    issues.push({
      level: 'info',
      id,
      name,
      msg: 'Sacred Flame uses Source (on caster); TARGET type may expect bolt to target',
    });
  }
}

const byLevel = { error: [], warn: [], info: [] };
for (const i of issues) byLevel[i.level].push(i);

console.log(`Audited ${entries.length} spells\n`);
console.log(`Errors: ${byLevel.error.length}`);
console.log(`Warnings: ${byLevel.warn.length}`);
console.log(`Info: ${byLevel.info.length}\n`);

for (const level of ['error', 'warn', 'info']) {
  if (!byLevel[level].length) continue;
  console.log(`=== ${level.toUpperCase()} ===`);
  for (const i of byLevel[level]) {
    console.log(`  [${i.name}] ${i.msg}`);
  }
  console.log('');
}

// List directed spells missing EXTRA_BEAM
const directedBeams = entries.filter((e) => e.jb2a.directed && listPrefix(e.jb2a.basename).some((f) => /\dft/i.test(f)));
const missingExtra = directedBeams.filter((e) => !EXTRA_BEAM.has(e.jb2a.basename));
if (missingExtra.length) {
  console.log('=== DIRECTED FT BEAMS WITHOUT EXTRA_BEAM_VARIANTS ===');
  for (const e of missingExtra) {
    console.log(`  ${e.name}: ${e.jb2a.basename}`);
  }
}

process.exit(byLevel.error.length > 0 ? 1 : 0);
