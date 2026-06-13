/** Owlbear extension compendium entry shapes (shared sync contract). */

export interface OwlbearMonster {
  name: string;
  type: string;
  source: string;
  hp: number;
  ac: number;
  cr: string;
  description: string;
  image?: string;
  stats?: Record<string, unknown>;
}

export interface OwlbearItem {
  name: string;
  type: string;
  source: string;
  description: string;
  rarity?: string;
  flavor?: string;
  details?: string;
  image?: string;
}

export interface OwlbearSpell {
  name: string;
  level: number;
  damage?: string;
  type?: string;
  save?: string;
  aoe?: { size: number; type: string };
  attack?: boolean;
  secondary?: { damage: string; type: string };
  description?: string;
  source?: string;
}

export interface CompendiumGlobalDoc {
  _id: 'global';
  monsters: OwlbearMonster[];
  items: OwlbearItem[];
  spells: OwlbearSpell[];
  deleted: string[];
  images: Record<string, string>;
  imagesData: Record<string, string>;
  /** Per-entry image history (entry name → up to 20 URLs), synced like Owlbear used-images. */
  entryImages?: Record<string, string[]>;
  lastUpdated: Date | string;
}

/** Raw Owlbear extension/Mongo global doc — SRD edits live in override* arrays. */
export interface OwlbearRawGlobalDoc extends Partial<CompendiumGlobalDoc> {
  _id?: 'global';
  overrideMonsters?: OwlbearMonster[];
  overrideItems?: OwlbearItem[];
  overrideSpells?: OwlbearSpell[];
  /** Source book labels hidden from players until entries are published. */
  lockedSources?: string[];
  /** `${kind}:${entryNameKey}` — public even when source is locked. */
  publishedEntryKeys?: string[];
}

function mergeEntryLists<T>(
  custom: T[] | undefined,
  overrides: T[] | undefined,
  keyFn: (entry: T) => string,
): T[] {
  const map = new Map<string, T>();
  for (const entry of custom ?? []) map.set(keyFn(entry), entry);
  for (const entry of overrides ?? []) map.set(keyFn(entry), entry);
  return Array.from(map.values());
}

/** Fold Owlbear override* arrays into monsters/items/spells for Grimoire merge. */
export function normalizeOwlbearGlobalDoc(raw: OwlbearRawGlobalDoc): CompendiumGlobalDoc {
  const lastUpdated = raw.lastUpdated
    ? new Date(raw.lastUpdated as string | Date).toISOString()
    : new Date(0).toISOString();

  return {
    _id: 'global',
    monsters: mergeEntryLists(raw.monsters, raw.overrideMonsters, (m) => m.name.trim().toLowerCase()),
    items: mergeEntryLists(raw.items, raw.overrideItems, (i) => i.name.trim().toLowerCase()),
    spells: mergeEntryLists(raw.spells, raw.overrideSpells, (s) => s.name.toLowerCase()),
    deleted: raw.deleted ?? [],
    images: raw.images ?? {},
    imagesData: raw.imagesData ?? {},
    entryImages: raw.entryImages ?? {},
    lastUpdated,
  };
}

export interface CompendiumMonster extends OwlbearMonster {
  id: string;
  isCustom: boolean;
  isDeleted?: boolean;
  /** Hidden from non-admin until published (locked source). */
  isDraft?: boolean;
  /** Resolved loadable URL (custom override or catalog default). */
  imageUrl?: string;
  /** Parsed from stat block when available. */
  damageResistances?: string[];
  damageImmunities?: string[];
  damageVulnerabilities?: string[];
}

export interface CompendiumItem extends OwlbearItem {
  id: string;
  isCustom: boolean;
  isDraft?: boolean;
  imageUrl?: string;
}

export interface CompendiumSpell extends OwlbearSpell {
  id: string;
  isCustom: boolean;
  isDraft?: boolean;
  imageUrl?: string;
}

export type MongoHealthState = 'disabled' | 'connected' | 'degraded' | 'circuit-open' | 'unavailable';

/** Live MongoDB probe snapshot (server refreshes on a background interval). */
export interface CompendiumMongoHealth {
  state: MongoHealthState;
  configured: boolean;
  circuitOpen: boolean;
  lastCheckedAt?: string;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastError?: string;
  latencyMs?: number;
}

export interface CompendiumSyncStatus {
  lastUpdated: string;
  storage: 'mongodb' | 'postgresql' | 'local' | 'unavailable';
  mongoConnected?: boolean;
  mongoHealth?: CompendiumMongoHealth;
  /** In-memory catalog revision after last rebuild. */
  catalogRev?: string;
  entryCounts?: { monsters: number; items: number; spells: number };
  /** Present while the in-memory catalog is being rebuilt after a large import. */
  catalogRebuild?: CatalogRebuildProgress;
}

/** Live progress for background compendium catalog rebuilds. */
export interface CatalogRebuildProgress {
  active: boolean;
  phase: string;
  label: string;
  /** 0–100 */
  percent: number;
  startedAt: string;
  entryCounts?: { monsters?: number; items?: number; spells?: number };
  importCounts?: { monsters: number; items: number; spells: number };
}

export type CompendiumImageKind = 'monster' | 'item' | 'spell';

export interface CompendiumEntryImageState {
  key: string;
  current: string | null;
  history: string[];
  /** All stored compendium images any user can pick from. */
  library?: string[];
  /** Bumps when image data changes; use for cache-busting static-image URLs. */
  updatedAt?: string;
}

export interface CompendiumSearchResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

/** Source book entry for browse-by-source UI. */
export interface CompendiumSource {
  id: string;
  label: string;
  count: number;
  /** Admin-only: entire source is locked for review. */
  locked?: boolean;
  /** Admin-only: entries not yet published. */
  draftCount?: number;
}

export interface CompendiumVisibilityPolicy {
  lockedSources: string[];
  publishedEntryKeys: string[];
}

export type CompendiumSaveAs = 'replace' | 'homebrew';

export function splitCompendiumSources(source: string | undefined): string[] {
  if (!source?.trim()) return [];
  return source.split(/,\s*/).map((s) => s.trim()).filter(Boolean);
}

/** True when an entry belongs in the Homebrew browse tab. */
export function isHomebrewEntry(isCustom: boolean, source?: string): boolean {
  const parts = splitCompendiumSources(source);
  if (parts.some((p) => p.toLowerCase() === 'custom')) return true;
  if (isCustom && parts.length > 0) return false;
  return isCustom;
}

/** True when an entry comes from a source book (not homebrew). */
export function isFromSourceBook(isCustom: boolean, source?: string): boolean {
  return splitCompendiumSources(source).length > 0 && !isHomebrewEntry(isCustom, source);
}

function isStandardItemCategory(type: string): boolean {
  const t = type.trim();
  if (!t) return true;
  if (/\bdamage\b|\babsorb|\battunement|\beffect\b/i.test(t)) return false;
  if (/^[a-z]/.test(t) && !/^(very )?(rare|common|uncommon|legendary|artifact)/i.test(t)) return false;
  if (/^(wondrous item|weapon|armor|potion|ring|rod|staff|wand|scroll)(\s|,|\(|$)/i.test(t) && t.length < 48) {
    return true;
  }
  return false;
}

/** Build handout/push text when description fields are empty (common with PDF imports). */
export function synthesizeCompendiumItemDescription(item: {
  name?: string;
  type?: string;
  description?: string;
  flavor?: string;
  details?: string;
}): string {
  for (const field of [item.description, item.flavor, item.details]) {
    const text = field?.trim();
    if (text) return text;
  }

  const name = (item.name ?? '')
    .replace(/^[\s•·▪▫◦‣⁃\-–—*+>]+/u, '')
    .trim();
  const type = item.type?.trim() ?? '';
  const colonIdx = name.indexOf(':');
  const suffixFromName = colonIdx >= 0 ? name.slice(colonIdx + 1).trim() : '';
  const typeAsRules = type && !isStandardItemCategory(type) ? type : '';
  return [suffixFromName, typeAsRules].filter(Boolean).join(' ').trim();
}
