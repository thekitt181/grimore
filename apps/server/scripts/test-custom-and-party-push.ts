import 'dotenv/config';
import { getCobaltForUser } from '../src/services/ddb/ddbService';
import { pushHandoutItemToDdb, handoutItemMetaToPushInput } from '../src/services/ddb/characterInventoryPush';
import { fetchRawCharacter } from '../src/services/ddb/characterExtract';

const USER = 'cmq9yt92e0001146vj4mns8e8';
const CHAR = 164632019;
const CAMPAIGN = 6133312;

async function main() {
  const cobalt = await getCobaltForUser(USER);
  if (!cobalt) throw new Error('no cobalt');

  const customInput = handoutItemMetaToPushInput(
    { name: 'Superior Elemental Protection Trinket: Absorbs 60', itemType: 'Wondrous Item', rarity: 'Rare' },
    'Superior Elemental Protection Trinket: Absorbs 60',
    'Absorbs 60 damage',
  );
  console.log('custom input', customInput);
  const customResult = await pushHandoutItemToDdb(cobalt, CHAR, customInput);
  console.log('custom result', customResult);

  const before = await fetchRawCharacter(cobalt, CHAR);
  const beforeCount = Array.isArray(before.inventory) ? before.inventory.length : 0;

  const partyResult = await pushHandoutItemToDdb(cobalt, CHAR, {
    name: 'Dagger, +1',
    ddbDefinitionId: 5225,
    isCustom: false,
  }, { target: 'party', ddbCampaignId: CAMPAIGN });
  console.log('party result', partyResult);

  const after = await fetchRawCharacter(cobalt, CHAR);
  const afterCount = Array.isArray(after.inventory) ? after.inventory.length : 0;
  console.log('personal inventory', beforeCount, '->', afterCount, '(party add should not increase)');
}

main().catch(console.error);
