import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Load compiled TS via tsx if available, else use direct import path
const { extractVitals } = await import('../src/services/ddb/vitalsExtract.ts');

function angeloFixture() {
  return {
    name: 'Angelo',
    level: 4,
    baseHitPoints: 52,
    bonusHitPoints: null,
    removedHitPoints: 16,
    temporaryHitPoints: 0,
    stats: [
      { id: 1, value: 14 },
      { id: 2, value: 12 },
      { id: 3, value: 14 }, // CON +2
      { id: 4, value: 10 },
      { id: 5, value: 10 },
      { id: 6, value: 10 },
    ],
    bonusStats: Array.from({ length: 6 }, () => ({ value: null })),
    overrideStats: Array.from({ length: 6 }, () => ({ value: null })),
    classes: [{ level: 4, definition: { name: 'Fighter' } }],
    modifiers: { feat: [], class: [], race: [] },
    feats: [],
    inventory: [],
  };
}

function toughFixture() {
  const raw = angeloFixture();
  raw.feats = [{ definition: { name: 'Tough', modifiers: [] } }];
  raw.modifiers.feat = [
    {
      type: 'bonus',
      subType: 'hit-points-per-level',
      value: 2,
      friendlySubtypeName: 'Hit Points per Level',
    },
  ];
  return raw;
}

function sampleOverride() {
  const path =
    'C:/Users/Admin/.cursor/projects/c-Users-Admin-Desktop/agent-tools/b3c36a7c-3949-45a1-8772-0bf5f289ce72.txt';
  const json = JSON.parse(readFileSync(path, 'utf8'));
  return json.data;
}

const cases = [
  ['Angelo (null bonusHitPoints)', angeloFixture(), { hp: 44, maxHp: 60 }],
  ['Angelo + Tough feat', toughFixture(), { hp: 52, maxHp: 68 }],
  ['Sample override character', sampleOverride(), { hp: 73, maxHp: 73 }],
];

let failed = 0;
for (const [label, raw, expected] of cases) {
  const result = extractVitals(raw);
  const ok = result.hp === expected.hp && result.maxHp === expected.maxHp;
  console.log(`${ok ? 'OK' : 'FAIL'} ${label}: got ${result.hp}/${result.maxHp}, want ${expected.hp}/${expected.maxHp}`);
  if (!ok) failed++;
}

process.exit(failed > 0 ? 1 : 0);
