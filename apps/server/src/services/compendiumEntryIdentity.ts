import type { OwlbearItem, OwlbearMonster, OwlbearSpell } from '@grimoire/shared';
import { slugify } from '@grimoire/monster-dex';
import { entryNameKey } from './compendiumMerge';
import { normalizeSourceLabel } from './compendiumVisibility';
import type { CompendiumKind } from './compendiumOwlbearPersist';

type AnyEntry = OwlbearMonster | OwlbearItem | OwlbearSpell;

function normalizeText(text: string | undefined): string {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

function sortedJson(value: unknown): string {
  if (value == null) return '';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return JSON.stringify(value);
  const obj = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) sorted[key] = obj[key];
  return JSON.stringify(sorted);
}

/** Stable Postgres / catalog id — one row per book source + name (not name alone). */
export function compendiumEntryStorageId(
  name: string,
  source: string | undefined,
  legacyId?: string,
): string {
  if (legacyId?.trim()) return legacyId.trim();
  const src = normalizeSourceLabel(source?.trim() || 'unknown') || 'unknown';
  const base = slugify(`${src}::${name}`);
  return base.slice(0, 120) || slugify(name);
}

/** Merge map key: same name in different books are distinct slots. */
export function compendiumCatalogMergeKey(name: string, source: string | undefined): string {
  const src = normalizeSourceLabel(source?.trim() || '') || '';
  return `${entryNameKey(name)}\0${src}`;
}

export function compendiumContentFingerprint(kind: CompendiumKind, entry: AnyEntry): string {
  if (kind === 'monster') {
    const m = entry as OwlbearMonster;
    return [
      'monster',
      normalizeText(m.name),
      normalizeText(m.type),
      String(m.hp ?? ''),
      String(m.ac ?? ''),
      String(m.cr ?? ''),
      normalizeText(m.description),
      sortedJson(m.stats),
    ].join('\n');
  }
  if (kind === 'item') {
    const i = entry as OwlbearItem;
    const stats = 'stats' in i ? sortedJson((i as { stats?: unknown }).stats) : '';
    return [
      'item',
      normalizeText(i.name),
      normalizeText(i.type),
      normalizeText(i.description),
      normalizeText(i.flavor),
      normalizeText(i.details),
      stats,
    ].join('\n');
  }
  const s = entry as OwlbearSpell;
  return [
    'spell',
    normalizeText(s.name),
    String(s.level ?? ''),
    normalizeText(s.source),
    normalizeText(s.description),
    sortedJson(s),
  ].join('\n');
}

/** Drop only word-identical stat blocks — keep same name across different books. */
export function dedupeByIdenticalContent<T extends AnyEntry>(
  kind: CompendiumKind,
  entries: T[] | undefined,
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const entry of entries ?? []) {
    if (!entry?.name?.trim()) continue;
    const fp = compendiumContentFingerprint(kind, entry);
    if (seen.has(fp)) continue;
    seen.add(fp);
    out.push(entry);
  }
  return out;
}

export function resolveEntryId(
  kind: CompendiumKind,
  entry: AnyEntry & { _id?: string },
): string {
  if (entry._id?.trim()) return entry._id.trim();
  return compendiumEntryStorageId(entry.name, entry.source);
}
