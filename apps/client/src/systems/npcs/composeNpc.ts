import type { NpcEntry } from './npcTypes';

const STOP = new Set([
  'a', 'an', 'the', 'in', 'on', 'of', 'with', 'and', 'or', 'to', 'for', 'from', 'by', 'at',
  'near', 'their', 'there', 'them', 'his', 'her', 'who', 'that', 'this', 'covering', 'covered',
  'wearing', 'wears', 'into', 'over', 'some', 'very', 'just', 'like',
]);

const COLORS = new Set([
  'gold', 'golden', 'silver', 'copper', 'bronze', 'brass', 'red', 'blue', 'green', 'black',
  'white', 'purple', 'crimson', 'scarlet', 'amber', 'emerald', 'sapphire',
]);

const FEMALE = new Set(['female', 'woman', 'girl', 'lady', 'lass', 'queen', 'dame']);
const MALE = new Set(['male', 'man', 'boy', 'gentleman', 'lord', 'sir']);
const CHILD = new Set(['child', 'kid', 'girl', 'boy', 'young']);

interface Kit {
  role: string;
  tag: string;
  ac: number;
  hp: number;
  attack: string;
  gear: string;
  hooks: string[];
  secrets: string[];
}

const KITS: Record<string, Kit> = {
  cleric: kit('Cleric', 'faith', 16, 27, 'Mace +5, 1d6+3 bludgeoning.', 'a holy symbol on a worn cord and vestments hemmed for the road', [
    'The offering bowl is full of coins from a god this shrine does not keep.',
    'Three wounded strangers asked for the same blessing, hours apart, and none will say who sent them.',
  ], [
    'The blessing works. The god who answers is not the one named on the door.',
    'Last month a healing took something in trade, and a scar on the wrist is the receipt.',
  ]),
  paladin: kit('Paladin', 'war', 18, 36, 'Longsword +5, 1d8+3 slashing.', 'polished half-plate and a cloak kept cleaner than the road allows', [
    'An oath was sworn to a lord who has since changed the order.',
    'A village is flying the banner and also hiding the person it was meant to protect.',
  ], [
    'The oath was broken once, quietly, and the next blow will show it.',
  ]),
  wizard: kit('Wizard', 'arcane', 12, 18, 'Dagger +2, 1d4 piercing.', 'ink-stained cuffs and a book closed with a clasp that is warm', [
    'A spell in the margin is newer than the rest of the page, and it names someone in the party.',
    'The tower they left is still answering letters.',
  ], [
    'One prepared spell is not theirs. It was copied from a voice in a dream.',
  ]),
  sorcerer: kit('Sorcerer', 'arcane', 13, 22, 'Dagger +3, 1d4+1 piercing.', 'scorched embroidery and eyes that catch light a moment too long', [
    'Wild magic singed a tavern sign into a warning nobody can read.',
    'A relative is offering coin to anyone who can prove the bloodline.',
  ], [
    'The power is borrowed from something that expects to be let out.',
  ]),
  warlock: kit('Warlock', 'arcane', 13, 24, 'Dagger +4, 1d4+2 piercing.', 'a plain cloak and a patron’s mark kept under the collar', [
    'The pact mark itches whenever a certain name is spoken.',
    'Someone else in town has the same mark and pretends not to notice.',
  ], [
    'The patron already collected once. The next favour is overdue.',
  ]),
  druid: kit('Druid', 'wild', 13, 24, 'Staff +4, 1d8+2 bludgeoning.', 'weathered leathers, moss at the hem, and a staff that was grown', [
    'The grove’s paths have started doubling back.',
    'Animals are leaving a circle they will not enter, and the circle is moving.',
  ], [
    'A boundary stone was moved years ago, and the wood is collecting the debt.',
  ]),
  ranger: kit('Ranger', 'wild', 14, 28, 'Longbow +5, 1d8+3 piercing.', 'quiet boots and a bow wrapped against the wet', [
    'Tracks in the treeline match a hunter who should still be in town.',
    'A bounty names a quarry that leaves no scent.',
  ], [
    'The last shot wounded something that has been following the blood trail back.',
  ]),
  rogue: kit('Rogue', 'underworld', 14, 18, 'Shortsword +5, 1d6+3 piercing.', 'a rain-dark coat and gloves with the fingertips cut away', [
    'A signet was lifted, and every cutpurse in the ward is being questioned for it.',
    'A locked case changed hands twice tonight and is lighter than it should be.',
  ], [
    'The theft was a plant. The fee was to be caught holding it, and {name} kept it anyway.',
  ]),
  bard: kit('Bard', 'town', 13, 18, 'Rapier +4, 1d8+2 piercing.', 'a travel lute with a new string and a smile that arrives before the introduction', [
    'A song they will not play is already being whistled in the market.',
    'Last night’s ballad named a scandal that had not happened yet.',
  ], [
    'The scandal is real, and they were paid to make it famous before the victim hears.',
  ]),
  barbarian: kit('Barbarian', 'war', 14, 40, 'Greataxe +5, 1d12+3 slashing.', 'a traveller’s cloak over scars that are kept visible on purpose', [
    'They were hired to escort a chest that started whispering.',
    'A rival band is using their name on jobs they refused.',
  ], [
    'The rage is owed to someone. Until that debt is paid, they will not stay for the celebration.',
  ]),
  fighter: kit('Fighter', 'war', 16, 32, 'Longsword +5, 1d8+3 slashing.', 'a mended mail shirt and a weapon that has been sharpened past pretty', [
    'A company was ordered to hold a bridge, and the order’s seal looks wrong.',
    'They are the last hire who walked away from a job and lived.',
  ], [
    'The seal was forged. They have not told the others, because the others already disobeyed.',
  ]),
  monk: kit('Monk', 'faith', 15, 22, 'Unarmed strike +5, 1d6+3 bludgeoning.', 'wrapped hands, bare feet, and a robe mended with temple thread', [
    'The monastery sent them out and will not say what they are looking for.',
    'A bell in town rings at the hour their order forbids.',
  ], [
    'They left before the vow was finished. The missing line of it is a name.',
  ]),
  artificer: kit('Artificer', 'craft', 15, 24, 'Hammer +4, 1d8+2 bludgeoning.', 'a tool belt, a lens on a chain, and a device that ticks when lied to', [
    'A customer wants a copy of a signet and will not leave a name.',
    'Something they built has started answering questions it was not asked.',
  ], [
    'They have made three such copies. Each rubbing is kept, in case the noose needs a direction.',
  ]),
  knight: kit('Knight', 'war', 18, 36, 'Longsword +5, 1d8+3 slashing.', 'half-plate over a travel-stained surcoat and a helm carried, not worn', [
    'Their company was told to hold a road against refugees.',
    'A challenge has been issued in their name by someone who fights dirtier.',
  ], [
    'They held the road against the order. The knights already know, and are waiting to see if they admit it.',
  ]),
  hunter: kit('Hunter', 'wild', 14, 23, 'Longbow +5, 1d8+3 piercing.', 'quiet boots, a longbow, and a brace of game taken cleanly', [
    'Something in the treeline is wearing a hunter’s gait.',
    'The season’s quarry is a person, and the poster is a week too new.',
  ], [
    'They wounded it last month and have been following their own trail ever since.',
  ]),
  assassin: kit('Assassin', 'underworld', 15, 22, 'Dagger +6, 1d4+4 piercing.', 'forgettable clothes and a knife worn where a coat hides it', [
    'A contract names someone who died last winter. The pay is still good.',
    'They were seen entering by a door the house does not have.',
  ], [
    'They wrote some of the contracts. A few of the names are rivals, not targets.',
  ]),
  necromancer: kit('Necromancer', 'arcane', 12, 21, 'Dagger +3, 1d4+1 piercing.', 'clean hands, a humble robe, and grave-dirt that will not brush off the hem', [
    'A grave opened from the inside, and the name on the stone is still walking the market.',
    'They offer to sit with the grieving after dark.',
  ], [
    'The dead they speak with are not the ones buried here.',
  ]),
  blacksmith: kit('Blacksmith', 'craft', 14, 27, 'Hammer +4, 1d8+2 bludgeoning.', 'a patched apron, soot in the creases, and arms corded from the hammer', [
    'Someone is buying every horseshoe they can forge and paying in foreign coin.',
    'A blade left for repair whispers when the forge is quiet.',
  ], [
    'They once forged a brand for a slaver company and have been paying to have it forgotten.',
  ]),
  merchant: kit('Merchant', 'town', 12, 16, 'Dagger +3, 1d4 piercing.', 'a bright waistcoat and a portable balance too fine for the mud', [
    'A rival is selling the same goods at a loss. The barrels are not what the label says.',
    'A locked strongbox arrived without a buyer and is heavier each morning.',
  ], [
    'Two casks in ten are watered, and the difference pays a debt that could ruin them.',
  ]),
  innkeeper: kit('Innkeeper', 'town', 11, 16, 'Club +2, 1d4 bludgeoning.', 'flour on the cuffs, a ring of keys, and an eye on every door', [
    'A guest left a locked case and never came back.',
    'Rooms are full, but the ledger shows three guests who never ate.',
  ], [
    'The case is under the hearth. The letters inside have already been read.',
  ]),
  noble: kit('Noble', 'noble', 12, 20, 'Rapier +3, 1d8+1 piercing.', 'impeccable cloth, a mourning ring, and eyes that count the exits', [
    'They want a quiet retrieval from their own vault and will not say who holds the second key.',
    'A banquet is planned for a guest who has asked not to be announced.',
  ], [
    'The vault holds altered receipts. The clerk who noticed is missing.',
  ]),
  guard: kit('Guard', 'war', 16, 22, 'Spear +4, 1d6+2 piercing.', 'a city tabard over a mail shirt and a ledger instead of a drawn sword', [
    'Three night watches vanished near the same alley.',
    'They will look the other way once, and the price is a name, not coin.',
  ], [
    'One of the missing is family, and the debts were hidden in the watch book.',
  ]),
  pirate: kit('Pirate', 'sea', 14, 24, 'Scimitar +4, 1d6+2 slashing.', 'salt-white scars, a knit cap, and a knife reachable in a roll', [
    'The last cargo was sealed crates that sweated in cold weather.',
    'A flag they will not fly has been seen on a ship that knows their name.',
  ], [
    'One crate was opened. Inside was a map that redraws the coast each hour.',
  ]),
  wanderer: kit('Wanderer', 'road', 12, 16, 'Dagger +3, 1d4+1 piercing.', 'road-stained clothes and a pack buckled for a quick leaving', [
    '{name} arrived the same hour as the trouble and claims the timing is rude luck.',
    'A letter in {name}\'s pocket is addressed to someone in the party.',
  ], [
    '{name} has been this way before, under another name, and the town still owes an answer.',
  ]),
};

const ROLE_ALIAS: Record<string, string> = {
  cleric: 'cleric', priest: 'cleric', healer: 'cleric',
  paladin: 'paladin',
  wizard: 'wizard', mage: 'wizard', scholar: 'wizard',
  sorcerer: 'sorcerer',
  warlock: 'warlock',
  druid: 'druid', warden: 'druid',
  ranger: 'ranger',
  rogue: 'rogue', thief: 'rogue', rouge: 'rogue',
  bard: 'bard',
  barbarian: 'barbarian',
  fighter: 'fighter', warrior: 'fighter', sellsword: 'fighter', mercenary: 'fighter',
  monk: 'monk',
  artificer: 'artificer', tinkerer: 'artificer',
  knight: 'knight',
  hunter: 'hunter',
  assassin: 'assassin',
  necromancer: 'necromancer',
  blacksmith: 'blacksmith', smith: 'blacksmith',
  merchant: 'merchant', trader: 'merchant',
  innkeeper: 'innkeeper', barkeep: 'innkeeper', bartender: 'innkeeper',
  noble: 'noble',
  guard: 'guard', captain: 'guard',
  pirate: 'pirate', sailor: 'pirate',
};

const ANCESTRY_ALIAS: Array<[string, string]> = [
  ['dragonborn', 'Dragonborn'],
  ['half-elf', 'Half-elf'],
  ['half-orc', 'Half-orc'],
  ['tiefling', 'Tiefling'],
  ['halfling', 'Halfling'],
  ['gnome', 'Gnome'],
  ['dwarf', 'Dwarf'],
  ['elf', 'Elf'],
  ['orc', 'Orc'],
  ['human', 'Human'],
  ['goblin', 'Goblin'],
  ['kobold', 'Kobold'],
  ['tabaxi', 'Tabaxi'],
  ['kenku', 'Kenku'],
  ['aasimar', 'Aasimar'],
  ['goliath', 'Goliath'],
  ['firbolg', 'Firbolg'],
  ['genasi', 'Genasi'],
  ['tortle', 'Tortle'],
  ['lizardfolk', 'Lizardfolk'],
  ['bugbear', 'Bugbear'],
  ['hobgoblin', 'Hobgoblin'],
  ['gnoll', 'Gnoll'],
  ['dragon', 'Dragon'],
];

const GIVEN: Record<string, [string[], string[]]> = {
  Dragonborn: [
    ['Akra', 'Biri', 'Daar', 'Harann', 'Kava', 'Mishann', 'Nala', 'Sora', 'Thava', 'Uadjit'],
    ['Arjhan', 'Balasar', 'Bharash', 'Ghesh', 'Kriv', 'Medrash', 'Mehen', 'Rhogar', 'Shamash', 'Torinn'],
  ],
  Elf: [
    ['Naevys', 'Liriel', 'Sylrae', 'Mira', 'Ariadne', 'Vaela'],
    ['Theren', 'Aelar', 'Varis', 'Erevan', 'Cael', 'Faelor'],
  ],
  'Half-elf': [
    ['Branwen', 'Isolde', 'Maren', 'Tessa', 'Ysabel'],
    ['Corin', 'Edric', 'Leif', 'Rowan', 'Tomas'],
  ],
  Dwarf: [
    ['Hilda', 'Bruni', 'Disa', 'Kathra', 'Vonda'],
    ['Barendd', 'Darrak', 'Orsik', 'Thorin', 'Vondal'],
  ],
  Halfling: [
    ['Cora', 'Lavinia', 'Lidda', 'Seraphina', 'Verna'],
    ['Corrin', 'Finnan', 'Milo', 'Perrin', 'Wellby'],
  ],
  Gnome: [
    ['Bimpnottin', 'Ellywick', 'Nyx', 'Zanna', 'Pippa'],
    ['Alston', 'Boddynock', 'Dimble', 'Fonkin', 'Zook'],
  ],
  Orc: [
    ['Baggi', 'Emen', 'Kansif', 'Ovak', 'Shautha', 'Sutha'],
    ['Dench', 'Feng', 'Gell', 'Henk', 'Holg', 'Imsh', 'Keth', 'Ront', 'Shump', 'Thokk'],
  ],
  'Half-orc': [
    ['Kansif', 'Ovak', 'Shautha', 'Vera'],
    ['Dench', 'Feng', 'Holg', 'Ront', 'Thokk'],
  ],
  Tiefling: [
    ['Akta', 'Anakis', 'Bryseis', 'Criella', 'Kallista', 'Lerissa'],
    ['Akmenos', 'Amnon', 'Barakas', 'Damakos', 'Iados', 'Kairon'],
  ],
  Goblin: [
    ['Izza', 'Nix', 'Rox', 'Zib'],
    ['Grik', 'Mog', 'Pox', 'Skab'],
  ],
  Dragon: [
    ['Aurex', 'Vexia', 'Syrina', 'Ophira'],
    ['Bharash', 'Vorinax', 'Cyrion', 'Thalax'],
  ],
};

const FAMILY: Record<string, string[]> = {
  Dragonborn: ['Ashscale', 'Stormbrow', 'Emberjaw', 'Keenscale', 'Brightcoil'],
  Elf: ['Moonwhisper', 'Starling', 'Oakbinder', 'Nightbloom'],
  Dwarf: ['Ironfoot', 'Coppervein', 'Stonebrow', 'Forgehand'],
  Halfling: ['Goodbarrel', 'Tealeaf', 'Underbough', 'Brushgather'],
  Gnome: ['Lens', 'Sparkwhistle', 'Nib', 'Cogbright'],
  Human: ['Bram', 'Hollis', 'Carr', 'Merrick', 'Ashford', 'Penrose', 'Darrow', 'Keene'],
  Dragon: ['Ashscale', 'Stormbrow', 'Emberjaw', 'Keenscale'],
  Goblin: ['Nettle', 'Quickfinger', 'Mudpot', 'Snag'],
  Tiefling: ['Nightglass', 'Cinder', 'Thorn', 'Vex'],
  Orc: ['Thornjaw', 'Stonehide', 'Redtusk'],
  'Half-orc': ['Thornjaw', 'Stonehide', 'Keene'],
};

const CLAN_BY_COLOR: Record<string, string[]> = {
  gold: ['Sunscale', 'Brightcoin', 'Gildjaw'],
  silver: ['Moonscale', 'Palebrow', 'Starcoil'],
  red: ['Emberjaw', 'Cinderclaw', 'Pyrescale'],
  blue: ['Stormbrow', 'Tidecrest', 'Galvanos'],
  green: ['Mossscale', 'Venomspine', 'Thornjaw'],
  black: ['Ashscale', 'Nightmaw', 'Cinderveil'],
  white: ['Frostjaw', 'Palehorn', 'Rimescale'],
  copper: ['Coppervein', 'Verdigris', 'Brightpenny'],
  bronze: ['Brazenjaw', 'Bellscale', 'Oakhorn'],
  brass: ['Brightcoil', 'Banescale', 'Warmhide'],
};

const VOICE: Record<string, string> = {
  Dragonborn: 'Low, with a hiss on the s sounds, and a pause before a Common word.',
  Elf: 'Soft, precise, and slightly amused.',
  Dwarf: 'Gravel, short sentences, a laugh like a bellows.',
  Halfling: 'Quick and bright, dropping to a whisper for the real point.',
  Gnome: 'Light, quick, precise about small things.',
  Orc: 'Deep, careful Common, with pauses to pick the word.',
  Tiefling: 'Warm, then suddenly flat when the bargain starts.',
  Goblin: 'Fast, grinning, gone before the punchline lands.',
  Dragon: 'Slow enough that the room stays quiet for it.',
};

const FEATURE: Record<string, string> = {
  Dragonborn: 'a ridged brow and claws kept blunt for company',
  Elf: 'ears just visible under travel-worn hair',
  'Half-elf': 'one ear notched, the other hidden by a collar',
  Dwarf: 'a beard braided out of the work',
  Halfling: 'curled hair and boots too fine for the mud',
  Gnome: 'a magnifying lens on a chain and ink on the cuffs',
  Orc: 'tusks capped so they do not catch the light',
  'Half-orc': 'a careful smile that keeps the tusks polite',
  Tiefling: 'horns filed just enough to pass a doorway',
  Goblin: 'sharp ears and a grin with a tooth missing',
  Human: 'a face people forget until the poster matches',
  Dragon: 'a long shadow and scales that click when they shift',
  Kobold: 'bright eyes and a tail curled around one ankle',
  Tabaxi: 'fur dusted from the road and whiskers that track the room',
  Aasimar: 'a faint glow at the throat when they tell the truth',
  Goliath: 'slate-grey skin and tattoos that mark a climb',
};

const DETAIL_NOUN: Record<string, string> = {
  cloak: 'a cloak',
  hood: 'a hood',
  mask: 'a mask',
  robe: 'a robe',
  staff: 'a staff',
  bow: 'a bow',
  sword: 'a sword',
  scar: 'a scar',
  beard: 'a beard',
  tattoo: 'a tattoo',
  hat: 'a hat',
  crown: 'a crown worn like it might be taken back',
  face: 'a face kept partly hidden',
  eye: 'one eye clouded',
  armor: 'battered armor',
  plate: 'half-plate',
  shield: 'a battered shield',
};

/** A codex person made from a search such as "gold dragonborn cleric". */
export function composeNpc(raw: string): NpcEntry | null {
  const prompt = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!prompt) return null;
  const normalized = prompt
    .replace(/half[\s-]+elf/g, 'half-elf')
    .replace(/half[\s-]+orc/g, 'half-orc')
    .replace(/dragon[\s-]*born/g, 'dragonborn')
    .replace(/\brouge\b/g, 'rogue');
  const tokens = normalized.split(/[^a-z0-9-]+/).filter((word) => word.length > 2 && !STOP.has(word));
  if (tokens.length === 0) return null;

  let gender: 'female' | 'male' | '' = '';
  let child = false;
  let color = '';
  let kitKey = 'wanderer';
  let spoken = '';
  let ancestry = 'Human';
  const details: string[] = [];
  const used = new Set<string>();

  for (const token of tokens) {
    if (FEMALE.has(token)) {
      gender = 'female';
      used.add(token);
      if (token === 'girl') child = true;
    } else if (MALE.has(token)) {
      gender = 'male';
      used.add(token);
      if (token === 'boy') child = true;
    }
    if (CHILD.has(token)) {
      child = true;
      used.add(token);
    }
    if (COLORS.has(token) && !color) {
      color = token === 'golden' ? 'gold' : token;
      used.add(token);
    }
    if (ROLE_ALIAS[token] && !spoken) {
      kitKey = ROLE_ALIAS[token];
      spoken = token === 'rouge' ? 'rogue' : token;
      used.add(token);
    }
  }
  for (const [key, label] of ANCESTRY_ALIAS) {
    if (tokens.includes(key)) {
      ancestry = label;
      used.add(key);
      break;
    }
  }
  for (const token of tokens) {
    if (!used.has(token)) details.push(token);
  }

  const kit = KITS[kitKey] ?? KITS.wanderer;
  if (!kit) return null;
  const seed = hash(normalized);
  const name = chooseName(ancestry, gender, color, seed);
  const who = gender === 'female' ? 'She' : gender === 'male' ? 'He' : 'They';
  const them = gender === 'female' ? 'her' : gender === 'male' ? 'his' : 'their';
  const be = who === 'They' ? 'are' : 'is';
  const watch = who === 'They' ? 'watch' : 'watches';
  const feature = FEATURE[ancestry] ?? 'a traveller’s posture and clothes chosen to be forgotten';
  const given = name.split(' ')[0] ?? name;
  const kind = [
    child ? 'young' : '',
    gender === 'female' ? 'female' : gender === 'male' ? 'male' : '',
    color,
    ancestry.toLowerCase(),
    (spoken || kit.role).toLowerCase(),
  ].filter(Boolean).join(' ');
  const extra = detailClause(details);
  const article = /^[aeiou]/i.test(kind) ? 'an' : 'a';
  const appearance = `${given} is ${article} ${kind} with ${feature}, wearing ${kit.gear}.${extra} ${who} ${watch} the exits before the faces.`.replace(/\s+/g, ' ').trim();
  const personalities = [
    `${who} ${be} polite until the work starts, then exact.`,
    `Warm with allies and finished with anyone who wastes ${them} time.`,
    `Curious to the point of risk, and unwilling to leave a question half answered.`,
    `Professional. The price is named once and kept.`,
  ];
  const voices = [
    VOICE[ancestry] ?? 'Even, clear, and hard to interrupt.',
    'Quiet, specific, and louder only when the room gets rude.',
  ];
  let ac = kit.ac;
  let hp = kit.hp;
  if (ancestry === 'Dragonborn' || ancestry === 'Orc' || ancestry === 'Half-orc' || ancestry === 'Goliath' || ancestry === 'Dragon') {
    ac += 1;
    hp += 6;
  }
  let attack = kit.attack;
  if (child) {
    hp = Math.max(6, Math.round(hp * 0.45));
    ac = Math.max(10, ac - 2);
    attack = 'Sling +3, 1d4 bludgeoning.';
  }
  const hook = fill(pick(kit.hooks, seed), name, who);
  const secret = fill(pick(kit.secrets, seed >>> 3), name, who);
  const tag = kit.tag;

  return {
    id: `npc-search-${seed.toString(36)}`,
    name,
    role: cap(spoken || kit.role),
    ancestry,
    tags: [tag],
    appearance,
    personality: pick(personalities, seed >>> 1),
    voice: pick(voices, seed >>> 2),
    hook,
    secret,
    ac,
    hp,
    attack,
    custom: true,
    prompt: normalized,
  };
}

function kit(
  role: string,
  tag: string,
  ac: number,
  hp: number,
  attack: string,
  gear: string,
  hooks: string[],
  secrets: string[],
): Kit {
  return { role, tag, ac, hp, attack, gear, hooks, secrets };
}

function chooseName(ancestry: string, gender: 'female' | 'male' | '', color: string, seed: number): string {
  const table = GIVEN[ancestry] ?? [
    ['Mara', 'Helen', 'Ruth', 'Adele', 'Nora', 'Willa'],
    ['Edgar', 'Hugh', 'Martin', 'Owen', 'Peter', 'Simon'],
  ];
  const given = pick(gender === 'female' ? table[0] : gender === 'male' ? table[1] : [...table[0], ...table[1]], seed);
  const colored = CLAN_BY_COLOR[color];
  const scaled = ancestry === 'Dragonborn' || ancestry === 'Dragon';
  const familyPool = scaled && colored ? colored : (FAMILY[ancestry] ?? FAMILY.Human ?? ['Keene']);
  const family = pick(familyPool, seed >>> 5);
  return `${given} ${family}`;
}

function detailClause(words: string[]): string {
  if (words.length === 0) return '';
  const bits = words.slice(0, 5).map((word) => DETAIL_NOUN[word] ?? word);
  return ` Also plain to see: ${humanJoin(bits)}.`;
}

function humanJoin(items: string[]): string {
  if (items.length === 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1] ?? ''}`;
}

function fill(line: string, name: string, who: string): string {
  return line.replaceAll('{name}', name).replaceAll('{who}', who);
}

function cap(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function pick<T>(items: readonly T[], seed: number): T {
  return items[seed % items.length] as T;
}

function hash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) h = Math.imul(h ^ value.charCodeAt(i), 16777619);
  return h >>> 0;
}
