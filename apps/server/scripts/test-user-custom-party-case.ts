import 'dotenv/config';
import { getCobaltForUser } from '../src/services/ddb/ddbService';
import {
  handoutItemMetaToPushInput,
  normalizeHandoutItemName,
  pushHandoutItemToDdb,
} from '../src/services/ddb/characterInventoryPush';

const USER = 'cmq9yt92e0001146vj4mns8e8';
const CHAR = 164632019;
const CAMPAIGN = 6133312;

async function main() {
  const cobalt = await getCobaltForUser(USER);
  if (!cobalt) throw new Error('no cobalt');

  const rawTitle = '• Superior Elemental Protection Trinket: Absorbs 60';
  console.log('normalized', normalizeHandoutItemName(rawTitle));

  const input = handoutItemMetaToPushInput(
    {
      name: 'Superior Elemental Protection Trinket: Absorbs 60',
      itemType: 'Wondrous Item',
      rarity: 'Rare',
      source: 'Dungeon Master\'s Guide',
    },
    rawTitle,
    'Absorbs 60 damage',
  );
  console.log('push input', input);

  const charResult = await pushHandoutItemToDdb(cobalt, CHAR, input);
  console.log('character result', charResult);

  const partyInput = { ...input, name: `${input.name} (party ${Date.now()})` };
  const partyResult = await pushHandoutItemToDdb(cobalt, CHAR, partyInput, {
    target: 'party',
    ddbCampaignId: CAMPAIGN,
  });
  console.log('party result', partyResult);
}

main().catch(console.error);
