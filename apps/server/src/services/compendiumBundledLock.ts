import type { OwlbearRawGlobalDoc } from '@grimoire/shared';
import { splitCompendiumSources } from '@grimoire/shared';
import { getCollection, isMongoCircuitOpen, withMongoTimeout } from '../lib/mongo';
import { loadLocalItems, loadLocalMonsters, loadLocalSpells } from './compendiumLocal';
import { notifyCompendiumPolicyChanged } from './compendiumChangeNotify';
import { patchRawGlobalFallbackPolicy } from './compendiumGlobalFallback';
import { normalizeEntryName } from './compendiumMerge';
import { markCompendiumWritePending } from './compendiumMongoWatch';
import { clearRawGlobalDocInflight } from './compendiumOwlbearPersist';
import { collectImportedSourceLabelsFromMongo } from './compendiumMongoReads';
import { invalidateVisibilityPolicyCache, readVisibilityPolicyFast, setVisibilityPolicyCache } from './compendiumPolicyCache';
import { normalizeSourceLabel, sourceMatchesLocked } from './compendiumVisibility';
import { enqueueCompendiumWrite } from './compendiumWriteQueue';

function collectSourcePartsFromEntries(
  entries: Array<{ source?: string }> | undefined,
  out: Set<string>,
): void {
  if (!Array.isArray(entries)) return;
  for (const entry of entries) {
    if (!entry?.source) continue;
    for (const part of splitCompendiumSources(entry.source)) {
      const trimmed = part.trim();
      if (!trimmed || trimmed.toLowerCase() === 'custom') continue;
      out.add(trimmed);
    }
  }
}

/** Unique source book labels from bundled JSON shipped with the server. */
export function collectBundledSourceLabels(): string[] {
  const labels = new Set<string>();
  collectSourcePartsFromEntries(loadLocalMonsters(), labels);
  collectSourcePartsFromEntries(loadLocalItems(), labels);
  collectSourcePartsFromEntries(loadLocalSpells(), labels);
  return [...labels];
}

export function bundledSourceLabelSet(): Set<string> {
  return new Set(collectBundledSourceLabels().map((l) => normalizeSourceLabel(l)));
}

export function isBundledSourceLabel(sourceId: string): boolean {
  return bundledSourceLabelSet().has(normalizeSourceLabel(sourceId));
}

/** Source book labels saved in Mongo/file overrides (DDB imports and manual edits). */
export async function collectImportedSourceLabels(): Promise<string[]> {
  const fromMongo = await collectImportedSourceLabelsFromMongo();
  if (fromMongo.length > 0) return fromMongo;

  const { readRawGlobalDoc } = await import('./compendiumOwlbearPersist');
  const raw = await readRawGlobalDoc({ includeImageData: false });
  const labels = new Set<string>();
  for (const list of [raw.overrideMonsters, raw.overrideItems, raw.overrideSpells]) {
    collectSourcePartsFromEntries(list, labels);
  }
  return [...labels];
}

export async function importedSourceLabelSet(): Promise<Set<string>> {
  const labels = await collectImportedSourceLabels();
  return new Set(labels.map((label) => normalizeSourceLabel(label)));
}

/** Source labels that exist only in Mongo/file overrides (e.g. DDB imports), not bundled JSON. */
export async function collectOverrideOnlySourceLabels(): Promise<string[]> {
  const bundled = bundledSourceLabelSet();
  const labels = await collectImportedSourceLabels();
  return labels.filter((label) => !bundled.has(normalizeSourceLabel(label)));
}

function normalizeLockLabel(sourceLabel: string): string {
  return normalizeSourceLabel(sourceLabel) || normalizeEntryName(sourceLabel).toLowerCase();
}

/**
 * Keep every bundled third-party source locked (idempotent).
 * DDB imports use override-only source names and are unlocked separately on import finish.
 */
export async function ensureBundledSourcesLocked(reason: string): Promise<number> {
  return enqueueCompendiumWrite(async () => {
    const bundled = collectBundledSourceLabels();
    if (bundled.length === 0) {
      console.warn(
        `[Compendium] No bundled source labels found (${reason}) — check apps/server/data/compendium on disk`,
      );
      return 0;
    }

    const policy = await readVisibilityPolicyFast();
    const locked = [...policy.lockedSources];
    const toLock: string[] = [];
    for (const label of bundled) {
      const norm = normalizeLockLabel(label);
      if (!norm) continue;
      if (locked.some((s) => sourceMatchesLocked(s, norm))) continue;
      locked.push(norm);
      toLock.push(norm);
    }

    if (toLock.length === 0) return 0;

    const lastUpdated = new Date().toISOString();
    const next = { ...policy, lockedSources: locked };
    const col = await getCollection<OwlbearRawGlobalDoc>('data');
    if (col && !isMongoCircuitOpen()) {
      markCompendiumWritePending();
      try {
        await withMongoTimeout(
          col.updateOne(
            { _id: 'global' },
            {
              $set: {
                lockedSources: next.lockedSources,
                publishedEntryKeys: next.publishedEntryKeys,
                lastUpdated,
              },
            },
            { upsert: true },
          ),
          15_000,
        );
      } catch (err) {
        console.warn(
          '[Compendium] Mongo bundled-lock write failed, using fallback:',
          err instanceof Error ? err.message : err,
        );
      }
    }
    patchRawGlobalFallbackPolicy(next, lastUpdated);
    clearRawGlobalDocInflight();
    invalidateVisibilityPolicyCache();
    setVisibilityPolicyCache(next, lastUpdated);
    notifyCompendiumPolicyChanged(lastUpdated, next);
    console.log(`[Compendium] Locked ${toLock.length} bundled source book(s) (${reason})`);
    return toLock.length;
  });
}

/**
 * Unlock every imported (override) book source so DDB imports stay visible in Compendium → Books.
 * Runs after bundled lock — idempotent recovery when imports were saved but never unlocked.
 */
export async function ensureImportedSourcesUnlocked(reason: string): Promise<number> {
  return enqueueCompendiumWrite(async () => {
    const imported = await collectImportedSourceLabels();
    if (imported.length === 0) return 0;

    const policy = await readVisibilityPolicyFast();
    const locked = [...policy.lockedSources];
    const toUnlock: string[] = [];

    for (const label of imported) {
      const norm = normalizeLockLabel(label);
      if (!norm) continue;
      const before = locked.length;
      const nextLocked = locked.filter(
        (s) => !sourceMatchesLocked(s, norm) && !sourceMatchesLocked(norm, s),
      );
      if (nextLocked.length < before) {
        locked.length = 0;
        locked.push(...nextLocked);
        toUnlock.push(label);
      }
    }

    if (toUnlock.length === 0) return 0;

    const lastUpdated = new Date().toISOString();
    const next = { ...policy, lockedSources: locked };
    const col = await getCollection<OwlbearRawGlobalDoc>('data');
    if (col && !isMongoCircuitOpen()) {
      markCompendiumWritePending();
      try {
        await withMongoTimeout(
          col.updateOne(
            { _id: 'global' },
            {
              $set: {
                lockedSources: next.lockedSources,
                publishedEntryKeys: next.publishedEntryKeys,
                lastUpdated,
              },
            },
            { upsert: true },
          ),
          15_000,
        );
      } catch (err) {
        console.warn(
          '[Compendium] Mongo imported-unlock write failed, using fallback:',
          err instanceof Error ? err.message : err,
        );
      }
    }
    patchRawGlobalFallbackPolicy(next, lastUpdated);
    clearRawGlobalDocInflight();
    invalidateVisibilityPolicyCache();
    setVisibilityPolicyCache(next, lastUpdated);
    notifyCompendiumPolicyChanged(lastUpdated, next);
    console.log(`[Compendium] Unlocked ${toUnlock.length} imported source book(s) (${reason})`);
    return toUnlock.length;
  });
}
