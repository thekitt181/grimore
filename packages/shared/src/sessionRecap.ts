export interface RecapLine {
  id: string;
  userId: string;
  username: string;
  text: string;
  at: number;
}

export interface RecapSection {
  id: string;
  title: string;
  bullets: string[];
}

export interface SessionRecapDoc {
  summary: string;
  sections: RecapSection[];
  lineCount: number;
  updatedAt: number;
  published: boolean;
}

export const EMPTY_SESSION_RECAP: SessionRecapDoc = {
  summary: '',
  sections: [],
  lineCount: 0,
  updatedAt: 0,
  published: false,
};

const FILLER = /^(uh+|um+|ah+|er+|hmm+|huh+|yeah|yep|yup|ok|okay|right|so+|like|well|anyway)\.?$/i;
const GREETING_ONLY =
  /^(hey|hi|hello|yo|sup|what'?s up|how'?s it going|good (morning|night|evening|luck)|thanks|thank you|cheers|sorry|my bad|no worries|np|cool|nice|awesome|true|fair)\b[\s!.?]*$/i;
const CHATTER =
  /\b(brb|afk|be right back|one sec|one second|hang on a sec|bathroom|toilet|doorbell|amazon|wifi|laggy|\blag\b|discord|zoom|headset|headphones|you'?re muted|i'?m muted|can you hear me|can everyone hear|mic check|unmute|background noise|pizza|burger|taco|(what'?s for|grab|order) (dinner|lunch|breakfast)|netflix|youtube|twitch|football|soccer|basketball|kids? are|my (dog|cat|kid|baby|wife|husband)|at work|work tomorrow|real life|\birl\b|off ?topic|side conversation|that'?s (so )?funny|hilarious|lmao+|rofl|lol+|haha+|jk\b|just kidding)\b/i;
const META_TECH =
  /\b(refresh the page|reload|screen share|share screen|tab froze|browser|chrome|firefox|connection dropped|you cut out|breaking up|echo|feedback)\b/i;
const COMBAT =
  /\b(attack|attacks|hit|hits|miss|missed|damage|dmg|initiative|unconscious|dying|death save|opportunity attack|critical|crit|nat 20|nat 1|\bac\b|hit points|\bhp\b|heal|heals|spell slot|concentration|sneak attack|multiattack|legendary|lair action|bloodied|flank|cover|grapple|shove|dodge|disengage|opportunity)\b/i;
const LOOT =
  /\b(\d+\s*(gp|gold|sp|pp|cp|ep)|loot|treasure|chest|potion|scroll|magic item|bag of|take the|found \d+|reward|payment|inventory|attune)\b/i;
const SOCIAL =
  /\b(persuade|persuasion|deceive|deception|intimidate|insight|bargain|promise|deal|quest|hired|betray|ally|allies|convince|negotiate|interrogat|bluff|diplomacy)\b/i;
const EXPLORE =
  /\b(door|doors|search|searches|perception|investigate|trap|secret|north|south|east|west|room|corridor|hall|dungeon|stairs|rest|camp|travel|map|torch|listen|knock|lockpick|pick the lock|hidden|alcove|passage)\b/i;
const RULES =
  /\b(advantage|disadvantage|saving throw|save against|short rest|long rest|level up|inspiration|exhaustion|prepared|skill check|ability check|\bdc\b|\bd20\b|\bd12\b|\bd10\b|\bd8\b|\bd6\b|\bd4\b|modifier|proficiency|whose turn|my turn)\b/i;
const SETTING =
  /\b(tavern|inn|keep|castle|temple|shrine|forest|cave|undead|skeleton|zombie|goblin|orc|dragon|kobold|guard|king|queen|duke|baron|wizard|fighter|rogue|cleric|paladin|bard|ranger|barbarian|monk|druid|warlock|sorcerer|campaign|adventur|npc|statblock|spell|cantrip|cast|ritual|wild shape|rage|smite)\b/i;
const TABLE_MOVE =
  /\b(i|we|you)\s+(attack|cast|move|search|open|kick|talk to|ask|hide|sneak|climb|jump|persuade|investigate|look|listen|rest|draw|ready|dodge|dash|help|grapple|shove|disengage|follow|enter|leave|loot|take|give|offer|intimidate|deceive)\b/i;
const RP_TALK =
  /\b((i|we|he|she|they)\s+(say|says|said|tell|tells|told|ask|asks|asked|reply|replies|whisper|whispers|shout|shouts|snarl|plead|beg|vow|swear|threaten|refuse|demand)|you (dare|will not|shall not|must not|may not)|thee|thou|\bthy\b|milord|milady|my lord|my lady|your grace|good (sir|woman|man)|innkeeper|stay behind me|cover me|on your (left|right)|we mean no harm|have mercy|stand aside|name your price|state your business|i don'?t trust|trust you|in character|as my character|roleplay|\brp\b)\b/i;
const RP_SCENE =
  /\b(bows? (deeply|low)?|kneels?|draws? (steel|sword|blade)|sheathes?|raises? (a |the )?(glass|mug|lantern|torch)|offers? (a |the )?(hand|seat|drink|ale)|pours? (an? |the )?(ale|wine|drink)|looks? (him|her|them) in the eye)\b/i;
const GM_PROMPT =
  /\b(you (see|hear|notice|feel|find)|make a|roll (a |me |perception|insight|stealth|athletics)|what'?s your|the (room|door|creature|guard|npc)|around the (corner|bend)|the (innkeeper|guard|merchant|priest|captain) (says|replies|asks|smiles|frowns))\b/i;
const SKILL =
  /\b(stealth|athletics|acrobatics|arcana|history|nature|religion|medicine|survival|performance|investigation|sleight of hand|animal handling)\b/i;
const PROPER = /\b([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?)\b/g;
const SKIP_PROPER = new Set([
  'The', 'This', 'That', 'Then', 'There', 'They', 'Them', 'You', 'Your',
  'And', 'But', 'For', 'With', 'From', 'Into', 'Okay', 'Alright', 'What',
  'When', 'Where', 'Why', 'Who', 'How', 'Yes', 'No', 'Maybe', 'Please',
  'Roll', 'Rolling', 'Check', 'Next', 'Turn', 'Discord', 'Pizza', 'Chrome',
  'Anyway', 'Sorry', 'Thanks', 'Hello',
]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function dndTableTalkScore(text: string, names?: string[]): number {
  const t = text.toLowerCase();
  let score = 0;
  if (CHATTER.test(t) || META_TECH.test(t)) score -= 4;
  if (GREETING_ONLY.test(t.trim())) score -= 3;
  if (COMBAT.test(t)) score += 3;
  if (LOOT.test(t)) score += 3;
  if (EXPLORE.test(t)) score += 3;
  if (RULES.test(t)) score += 3;
  if (SETTING.test(t)) score += 2;
  if (SOCIAL.test(t)) score += 2;
  if (SKILL.test(t)) score += 2;
  if (TABLE_MOVE.test(t)) score += 3;
  if (GM_PROMPT.test(t)) score += 3;
  if (RP_TALK.test(t) || RP_SCENE.test(t)) score += 3;
  if (/["“”][^"“”]{8,}["“”]/.test(text)) score += 2;
  if (/\b(roll|rolled|rolling)\b/i.test(t)) score += 2;
  for (const name of names ?? []) {
    const n = name.trim();
    if (n.length < 3) continue;
    if (new RegExp(`\\b${escapeRegExp(n)}\\b`, 'i').test(text)) score += 2;
  }
  return score;
}

export function cleanRecapUtterance(raw: string, names?: string[]): string {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (text.length < 3) return '';
  if (FILLER.test(text)) return '';
  if (GREETING_ONLY.test(text)) return '';
  if (dndTableTalkScore(text, names) <= 0) return '';
  return text.slice(0, 400);
}

function pushUnique(list: string[], line: string, cap: number): void {
  const t = line.replace(/\s+/g, ' ').trim();
  if (!t) return;
  const key = t.toLowerCase();
  if (list.some((x) => x.toLowerCase() === key)) return;
  list.push(t.length > 180 ? `${t.slice(0, 177)}…` : t);
  if (list.length > cap) list.shift();
}

function stitch(lines: RecapLine[]): RecapLine[] {
  const out: RecapLine[] = [];
  for (const line of lines) {
    const prev = out[out.length - 1];
    if (prev && prev.userId === line.userId && line.at - prev.at < 10_000) {
      prev.text = `${prev.text} ${line.text}`.replace(/\s+/g, ' ').trim();
      prev.at = line.at;
    } else {
      out.push({ ...line });
    }
  }
  return out;
}

export function buildSessionRecap(
  lines: RecapLine[],
  opts?: { published?: boolean; partyNames?: string[] },
): SessionRecapDoc {
  const partyHint = opts?.partyNames ?? [];
  const usable = stitch(
    lines
      .map((l) => ({ ...l, text: cleanRecapUtterance(l.text, partyHint) }))
      .filter((l) => l.text),
  );
  const combat: string[] = [];
  const loot: string[] = [];
  const social: string[] = [];
  const roleplay: string[] = [];
  const explore: string[] = [];
  const rules: string[] = [];
  const quotes: string[] = [];
  const names = new Map<string, number>();

  for (const line of usable) {
    const tagged = `${line.username}: ${line.text}`;
    if (COMBAT.test(line.text)) pushUnique(combat, tagged, 12);
    if (LOOT.test(line.text)) pushUnique(loot, tagged, 10);
    if (SOCIAL.test(line.text)) pushUnique(social, tagged, 10);
    if (RP_TALK.test(line.text) || RP_SCENE.test(line.text)) pushUnique(roleplay, tagged, 12);
    if (EXPLORE.test(line.text)) pushUnique(explore, tagged, 12);
    if (RULES.test(line.text)) pushUnique(rules, tagged, 8);
    if (line.text.length >= 18 && dndTableTalkScore(line.text, partyHint) >= 3) {
      pushUnique(quotes, tagged, 10);
    }
    let m: RegExpExecArray | null;
    const re = new RegExp(PROPER.source, 'g');
    while ((m = re.exec(line.text)) !== null) {
      const name = m[1]!;
      if (SKIP_PROPER.has(name)) continue;
      names.set(name, (names.get(name) ?? 0) + 1);
    }
  }

  const speakers = [...new Set(usable.map((l) => l.username))];
  const nameHits = [...names.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([n]) => n);
  const party = (opts?.partyNames ?? []).filter(Boolean);

  const sections: RecapSection[] = [];
  if (party.length) sections.push({ id: 'party', title: 'Party at the table', bullets: party });
  if (speakers.length) {
    sections.push({
      id: 'voices',
      title: 'Who spoke',
      bullets: speakers.map((s) => `${s} (${usable.filter((l) => l.username === s).length} lines)`),
    });
  }
  if (explore.length) sections.push({ id: 'explore', title: 'Exploration & travel', bullets: explore });
  if (combat.length) sections.push({ id: 'combat', title: 'Combat', bullets: combat });
  if (roleplay.length) sections.push({ id: 'roleplay', title: 'Roleplay (PCs & NPCs)', bullets: roleplay });
  if (social.length) sections.push({ id: 'social', title: 'Talk, deals & checks', bullets: social });
  if (nameHits.length) sections.push({ id: 'names', title: 'Names that came up', bullets: nameHits });
  if (loot.length) sections.push({ id: 'loot', title: 'Loot & rewards', bullets: loot });
  if (rules.length) sections.push({ id: 'rules', title: 'Rests, checks & rules', bullets: rules });
  if (quotes.length) sections.push({ id: 'beats', title: 'Key beats (as spoken)', bullets: quotes.slice(-8) });

  const lead = speakers.length ? speakers.join(', ') : 'The table';
  const bits: string[] = [];
  if (explore[0]) bits.push(explore[0]!.replace(/^[^:]+:\s*/, ''));
  if (combat[0]) bits.push('combat broke out');
  if (loot[0]) bits.push('loot changed hands');
  if (roleplay[0] || social[0]) bits.push('the party talked in character');
  const tail = usable.length
    ? usable[usable.length - 1]!.text
    : '';
  const summary = usable.length === 0
    ? 'No table voice captured yet. Join voice and talk — notes build as people speak.'
    : `${lead} at the table. ${bits.length ? `${bits.slice(0, 3).join('; ')}. ` : ''}${
      tail ? `Latest: “${tail.slice(0, 140)}${tail.length > 140 ? '…' : ''}”` : ''
    }`.trim();

  return {
    summary,
    sections,
    lineCount: lines.length,
    updatedAt: Date.now(),
    published: Boolean(opts?.published),
  };
}
