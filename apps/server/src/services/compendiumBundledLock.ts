import type { OwlbearRawGlobalDoc } from '@grimoire/shared';
import { splitCompendiumSources } from '@grimoire/shared';
import { getCollection, isMongoCircuitOpen, withMongoTimeout } from '../lib/mongo';
import { loadLocalItems, loadLocalMonsters, loadLocalSpells } from './compendiumLocal';
import { notifyCompendiumPolicyChanged } from './compendiumChangeNotify';
import { patchRawGlobalFallbackPolicy } from './compendiumGlobalFallback';
import { normalizeEntryName } from './compendiumMerge';
import { markCompendiumWritePending } from './compendiumMongoWatch';
import { clearRawGlobalDocInflight, persistRawGlobalDoc, readRawGlobalDoc } from './compendiumOwlbearPersist';
import { invalidateVisibilityPolicyCache, setVisibilityPolicyCache } from './compendiumPolicyCache';
import { normalizeSourceLabel, policyFromRaw, sourceMatchesLocked } from './compendiumVisibility';
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

/** Source labels that exist only in Mongo/file overrides (e.g. DDB imports), not bundled JSON. */
export async function collectOverrideOnlySourceLabels(): Promise<string[]> {
  const bundled = new Set(collectBundledSourceLabels().map((l) => normalizeSourceLabel(l)));
  const raw = await readRawGlobalDoc({ includeImageData: false });
  const overrideLabels = new Set<string>();
  for (const list of [raw.overrideMonsters, raw.overrideItems, raw.overrideSpells]) {
    collectSourcePartsFromEntries(list, overrideLabels);
  }
  return [...overrideLabels].filter((label) => !bundled.has(normalizeSourceLabel(label)));
}

function rawHasBundledSeedFlag(raw: OwlbearRawGlobalDoc): boolean {
  return Boolean((raw as OwlbearRawGlobalDoc & { bundledSourcesSeeded?: boolean }).bundledSourcesSeeded);
}

function normalizeLockLabel(sourceLabel: string): string {
  return normalizeSourceLabel(sourceLabel) || normalizeEntryName(sourceLabel).toLowerCase();
}

async function writeBundledSeedFlag(raw: OwlbearRawGlobalDoc, notify: 'none' | 'rebuild'): Promise<void> {
  await persistRawGlobalDoc(
    { ...raw, bundledSourcesSeeded: true } as OwlbearRawGlobalDoc,
    { notify },
  );
}

/**
 * One-time: lock every bundled third-party source book so players only see DDB imports
 * and books you explicitly unlock.
 */
export async function ensureBundledSourcesLocked(reason: string): Promise<number> {
  return enqueueCompendiumWrite(async () => {
    const raw = await readRawGlobalDoc({ includeImageData: false });
    if (rawHasBundledSeedFlag(raw)) return 0;

    const bundled = collectBundledSourceLabels();
    if (bundled.length === 0) {
      await writeBundledSeedFlag(raw, 'none');
      return 0;
    }

    const policy = policyFromRaw(raw);
    const locked = [...policy.lockedSources];
    const toLock: string[] = [];
    for (const label of bundled) {
      const norm = normalizeLockLabel(label);
      if (!norm) continue;
      if (locked.some((s) => sourceMatchesLocked(s, norm))) continue;
      locked.push(norm);
      toLock.push(norm);
    }

    if (toLock.length > 0) {
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
                  bundledSourcesSeeded: true,
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
    }

    const fresh = await readRawGlobalDoc({ includeImageData: false });
    if (!rawHasBundledSeedFlag(fresh)) {
      await writeBundledSeedFlag(fresh, toLock.length > 0 ? 'rebuild' : 'none');
    }

    return toLock.length;
  });
}
