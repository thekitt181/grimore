import { splitCompendiumSources } from '@grimoire/shared';
import type { CompendiumKind } from './compendiumOwlbearPersist';
import { entryNameKey, namesMatch, normalizeEntryName as mergeNormalizeEntryName } from './compendiumMerge';

export interface CompendiumVisibilityPolicy {
  lockedSources: string[];
  publishedEntryKeys: string[];
}

export function emptyVisibilityPolicy(): CompendiumVisibilityPolicy {
  return { lockedSources: [], publishedEntryKeys: [] };
}

export function publishedEntryKey(kind: CompendiumKind, name: string): string {
  return `${kind}:${entryNameKey(name)}`;
}

/** Normalize PDF filenames / underscores so lock labels match entry sources. */
export function normalizeSourceLabel(label: string): string {
  let s = mergeNormalizeEntryName(label);
  s = s.replace(/\.pdf$/i, '');
  s = s.replace(/_/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s.toLowerCase();
}

/** True when a compendium entry source matches a browse filter (book id / label). */
export function entryMatchesSource(source: string | undefined, filterSource: string): boolean {
  const normFilter = normalizeSourceLabel(filterSource);
  return splitCompendiumSources(source).some(
    (p) => p === filterSource || normalizeSourceLabel(p) === normFilter,
  );
}

/** True when a locked book label matches a compendium source part. */
export function sourceMatchesLocked(locked: string, sourcePart: string): boolean {
  if (!locked || !sourcePart) return false;
  if (namesMatch(locked, sourcePart)) return true;
  return normalizeSourceLabel(locked) === normalizeSourceLabel(sourcePart);
}

function sourceIsLocked(sourcePart: string, lockedSources: string[]): boolean {
  return lockedSources.some((locked) => sourceMatchesLocked(locked, sourcePart));
}

export function policyIsSourceLocked(
  sourceId: string,
  policy: CompendiumVisibilityPolicy,
): boolean {
  return policy.lockedSources.some((locked) => sourceMatchesLocked(locked, sourceId));
}

export function entryUsesLockedSource(
  source: string | undefined,
  lockedSources: string[],
): boolean {
  if (lockedSources.length === 0) return false;
  const parts = splitCompendiumSources(source);
  if (parts.length === 0) return false;
  return parts.some((part) => sourceIsLocked(part, lockedSources));
}

export function isEntryPublic(
  kind: CompendiumKind,
  name: string,
  source: string | undefined,
  policy: CompendiumVisibilityPolicy,
): boolean {
  const key = publishedEntryKey(kind, name);
  if (policy.publishedEntryKeys.some((k) => k === key)) return true;
  return !entryUsesLockedSource(source, policy.lockedSources);
}

export function isEntryDraft(
  kind: CompendiumKind,
  name: string,
  source: string | undefined,
  policy: CompendiumVisibilityPolicy,
): boolean {
  return !isEntryPublic(kind, name, source, policy);
}

export function policyFromRaw(raw: {
  lockedSources?: string[];
  publishedEntryKeys?: string[];
}): CompendiumVisibilityPolicy {
  return {
    lockedSources: [...(raw.lockedSources ?? [])],
    publishedEntryKeys: [...(raw.publishedEntryKeys ?? [])],
  };
}
