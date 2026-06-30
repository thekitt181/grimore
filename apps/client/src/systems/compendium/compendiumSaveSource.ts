import { splitCompendiumSources } from '@grimoire/shared';

function normalizeSourceLabel(label: string): string {
  return label
    .replace(/\.pdf$/i, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** When browsing one book, save replace edits against that book slot — not every source on the entry. */
export function resolveReplaceSaveSource(
  entrySource: string | undefined,
  selectedSource: string | null,
): string | undefined {
  if (!entrySource?.trim()) return entrySource;
  const parts = splitCompendiumSources(entrySource);
  if (!selectedSource?.trim() || parts.length <= 1) return entrySource;
  const filter = selectedSource.trim();
  const normFilter = normalizeSourceLabel(filter);
  const match = parts.find(
    (part) => part === filter || normalizeSourceLabel(part) === normFilter,
  );
  return match ?? entrySource;
}
