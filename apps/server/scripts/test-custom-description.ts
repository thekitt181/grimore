import 'dotenv/config';
import { getCobaltForUser } from '../src/services/ddb/ddbService';
import { pushHandoutItemToDdb, handoutItemMetaToPushInput } from '../src/services/ddb/characterInventoryPush';
import { fetchRawCharacter } from '../src/services/ddb/characterExtract';

const USER = 'cmq9yt92e0001146vj4mns8e8';
const CHAR = 164632019;
const stamp = Date.now();

async function main() {
  const cobalt = await getCobaltForUser(USER);
  if (!cobalt) throw new Error('no cobalt');

  const input = handoutItemMetaToPushInput(
    { itemType: 'Wondrous Item', rarity: 'Rare' },
    `Description Test ${stamp}`,
    'Absorbs 60 damage from one elemental type per short rest.',
  );

  const result = await pushHandoutItemToDdb(cobalt, CHAR, input);
  console.log('result', result);

  const raw = await fetchRawCharacter(cobalt, CHAR);
  const custom = (raw.customItems ?? []) as Record<string, unknown>[];
  const row = custom.find((c) => String(c.name ?? '').includes(`Description Test ${stamp}`));
  console.log('customItems row', row);

  const inv = (raw.inventory ?? []) as Record<string, unknown>[];
  const invRow = inv.find((r) => {
    const def = r.definition as Record<string, unknown> | undefined;
    return String(def?.name ?? r.name ?? '').includes(`Description Test ${stamp}`);
  });
  console.log('inventory notes', (invRow as Record<string, unknown> | undefined)?.notes);
}

main().catch(console.error);
