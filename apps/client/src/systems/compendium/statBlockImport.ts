/** Parse pasted stat-block text into compendium create-form fields. */

export interface ParsedMonsterFields {
  name?: string;
  type?: string;
  hp?: number;
  ac?: number;
  cr?: string;
  description: string;
}

export interface ParsedItemFields {
  name?: string;
  type?: string;
  description: string;
}

export interface ParsedSpellFields {
  name?: string;
  level?: number;
  description: string;
}

function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseIntField(text: string, patterns: RegExp[]): number | undefined {
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return undefined;
}

function looksLikeTypeLine(line: string): boolean {
  return /^(tiny|small|medium|large|huge|gargantuan)\b/i.test(line)
    && /,/.test(line);
}

function looksLikeHeaderLine(line: string): boolean {
  return /^(armor class|ac\b|hit points|hp\b|speed|challenge|str\b|actions|traits|legendary)/i.test(line);
}

export function parseMonsterStatBlock(raw: string): ParsedMonsterFields {
  const description = normalizeText(raw);
  const lines = description.split('\n').map((l) => l.trim()).filter(Boolean);

  let name: string | undefined;
  let type: string | undefined;
  for (const line of lines.slice(0, 8)) {
    if (looksLikeHeaderLine(line)) continue;
    if (looksLikeTypeLine(line)) {
      type = line;
      continue;
    }
    if (!name && line.length >= 2 && line.length <= 80 && !/^\d+$/.test(line)) {
      name = line.replace(/[*_#]+/g, '').trim();
    }
  }

  const ac = parseIntField(description, [
    /(?:Armor Class|AC)\s*(?:\([^)]*\))?\s*(\d+)/i,
    /\bAC\s*(\d+)\b/i,
  ]);
  const hp = parseIntField(description, [
    /Hit Points\s*(\d+)/i,
    /\bHP\s*(\d+)\b/i,
  ]);
  const crMatch = description.match(
    /Challenge(?:\s+Rating)?(?:\s*\(CR\))?\s*([\d/]+(?:\s*\(\s*[\d,]+\s*XP\s*\))?)/i,
  );
  const cr = crMatch?.[1]?.replace(/\s*\(.+$/, '').trim();

  const result: ParsedMonsterFields = { description };
  if (name) result.name = name;
  if (type) result.type = type;
  if (hp != null) result.hp = hp;
  if (ac != null) result.ac = ac;
  if (cr) result.cr = cr;
  return result;
}

export function parseItemStatBlock(raw: string): ParsedItemFields {
  const description = normalizeText(raw);
  const lines = description.split('\n').map((l) => l.trim()).filter(Boolean);
  const name = lines.find((l) => l.length >= 2 && l.length <= 80 && !looksLikeHeaderLine(l));
  const typeMatch = description.match(/\b(Wondrous item|Weapon|Armor|Potion|Ring|Rod|Staff|Wand|Scroll|Tool|Gear|Adventuring gear|.*? rarity)\b/i);
  const result: ParsedItemFields = { description };
  const itemName = name?.replace(/[*_#]+/g, '').trim();
  if (itemName) result.name = itemName;
  if (typeMatch?.[1]?.trim()) result.type = typeMatch[1].trim();
  return result;
}

export function parseSpellStatBlock(raw: string): ParsedSpellFields {
  const description = normalizeText(raw);
  const lines = description.split('\n').map((l) => l.trim()).filter(Boolean);
  const name = lines.find((l) => l.length >= 2 && l.length <= 80 && !/^(level|casting|range|components|duration)/i.test(l));
  const levelMatch = description.match(/\b(\d)(?:st|nd|rd|th)?[-\s]level\b/i)
    ?? description.match(/\blevel\s*(\d)\b/i)
    ?? description.match(/\bcantrip\b/i);
  const level = levelMatch
    ? (levelMatch[0]?.toLowerCase().includes('cantrip') ? 0 : parseInt(levelMatch[1] ?? '0', 10))
    : undefined;
  const result: ParsedSpellFields = { description };
  const spellName = name?.replace(/[*_#]+/g, '').trim();
  if (spellName) result.name = spellName;
  if (level != null && Number.isFinite(level)) result.level = level;
  return result;
}

export function applyMonsterFields(
  parsed: ParsedMonsterFields,
  setters: {
    setName: (v: string) => void;
    setType: (v: string) => void;
    setHp: (v: number) => void;
    setAc: (v: number) => void;
    setCr: (v: string) => void;
    setDescription: (v: string) => void;
  },
): number {
  let filled = 0;
  if (parsed.name) { setters.setName(parsed.name); filled += 1; }
  if (parsed.type) { setters.setType(parsed.type); filled += 1; }
  if (parsed.hp != null) { setters.setHp(parsed.hp); filled += 1; }
  if (parsed.ac != null) { setters.setAc(parsed.ac); filled += 1; }
  if (parsed.cr) { setters.setCr(parsed.cr); filled += 1; }
  if (parsed.description) { setters.setDescription(parsed.description); filled += 1; }
  return filled;
}

export function applyItemFields(
  parsed: ParsedItemFields,
  setters: {
    setName: (v: string) => void;
    setType: (v: string) => void;
    setDescription: (v: string) => void;
  },
): number {
  let filled = 0;
  if (parsed.name) { setters.setName(parsed.name); filled += 1; }
  if (parsed.type) { setters.setType(parsed.type); filled += 1; }
  if (parsed.description) { setters.setDescription(parsed.description); filled += 1; }
  return filled;
}

export function applySpellFields(
  parsed: ParsedSpellFields,
  setters: {
    setName: (v: string) => void;
    setLevel: (v: number) => void;
    setDescription: (v: string) => void;
  },
): number {
  let filled = 0;
  if (parsed.name) { setters.setName(parsed.name); filled += 1; }
  if (parsed.level != null) { setters.setLevel(parsed.level); filled += 1; }
  if (parsed.description) { setters.setDescription(parsed.description); filled += 1; }
  return filled;
}
