import type { OwlbearRawGlobalDoc } from '@grimoire/shared';
import { getCollection, isMongoCircuitOpen, withMongoTimeout } from '../lib/mongo';
import { enqueueCompendiumWrite } from './compendiumWriteQueue';
import type { CompendiumKind } from './compendiumOwlbearPersist';
import { clearRawGlobalDocInflight, readRawGlobalDoc } from './compendiumOwlbearPersist';
import { patchRawGlobalFallbackPolicy } from './compendiumGlobalFallback';
import { markCompendiumWritePending } from './compendiumMongoWatch';
import { notifyCompendiumPolicyChanged } from './compendiumChangeNotify';
import { normalizeEntryName } from './compendiumMerge';
import {
  emptyVisibilityPolicy,
  normalizeSourceLabel,
  policyFromRaw,
  publishedEntryKey,
  sourceMatchesLocked,
  type CompendiumVisibilityPolicy,
} from './compendiumVisibility';
import {
  invalidateVisibilityPolicyCache,
  readVisibilityPolicyFast,
  setVisibilityPolicyCache,
} from './compendiumPolicyCache';

export async function getCompendiumVisibilityPolicy(): Promise<CompendiumVisibilityPolicy> {
  return readVisibilityPolicyFast();
}

function normalizeLockLabel(sourceLabel: string): string {
  return normalizeSourceLabel(sourceLabel) || normalizeEntryName(sourceLabel).toLowerCase();
}

async function readPolicyDoc(): Promise<{
  policy: CompendiumVisibilityPolicy;
  lastUpdated: string;
}> {
  try {
    const col = await getCollection<OwlbearRawGlobalDoc>('data');
    if (col) {
      const doc = await withMongoTimeout(() => col.findOne(
          { _id: 'global' },
          { projection: { lockedSources: 1, publishedEntryKeys: 1, lastUpdated: 1 } },
        ),
        10_000,
      );
      if (doc) {
        const policy = policyFromRaw(doc);
        const lastUpdated = doc.lastUpdated
          ? new Date(doc.lastUpdated as string | Date).toISOString()
          : new Date().toISOString();
        return { policy, lastUpdated };
      }
    }
  } catch {
    // fall through
  }

  const raw = await readRawGlobalDoc({ includeImageData: false });
  return {
    policy: policyFromRaw(raw),
    lastUpdated: raw.lastUpdated
      ? new Date(raw.lastUpdated as string | Date).toISOString()
      : new Date().toISOString(),
  };
}

async function writePolicyDoc(
  policy: CompendiumVisibilityPolicy,
  lastUpdated: string,
): Promise<void> {
  const col = await getCollection<OwlbearRawGlobalDoc>('data');
  if (col && !isMongoCircuitOpen()) {
    markCompendiumWritePending();
    try {
      await withMongoTimeout(() => col.updateOne(
          { _id: 'global' },
          {
            $set: {
              lockedSources: policy.lockedSources,
              publishedEntryKeys: policy.publishedEntryKeys,
              lastUpdated,
            },
          },
          { upsert: true },
        ),
        15_000,
      );
    } catch (err) {
      console.warn(
        '[Compendium] Mongo policy write failed, using fallback:',
        err instanceof Error ? err.message : err,
      );
    }
  }

  patchRawGlobalFallbackPolicy(policy, lastUpdated);
  clearRawGlobalDocInflight();
  invalidateVisibilityPolicyCache();
  setVisibilityPolicyCache(policy, lastUpdated);
}

async function commitPolicyChange(
  policy: CompendiumVisibilityPolicy,
  lastUpdated: string,
): Promise<CompendiumVisibilityPolicy> {
  await writePolicyDoc(policy, lastUpdated);
  notifyCompendiumPolicyChanged(lastUpdated, policy);
  return policy;
}

export async function lockCompendiumSourcesBulk(sourceLabels: string[]): Promise<CompendiumVisibilityPolicy> {
  const labels = [...new Set(sourceLabels.map(normalizeLockLabel).filter(Boolean))];
  if (labels.length === 0) return emptyVisibilityPolicy();

  return enqueueCompendiumWrite(async () => {
    const { policy } = await readPolicyDoc();
    const locked = [...policy.lockedSources];
    for (const label of labels) {
      if (!locked.some((s) => sourceMatchesLocked(s, label))) {
        locked.push(label);
      }
    }
    const next = { ...policy, lockedSources: locked };
    const lastUpdated = new Date().toISOString();
    return commitPolicyChange(next, lastUpdated);
  });
}

export async function lockCompendiumSource(sourceLabel: string): Promise<CompendiumVisibilityPolicy> {
  const label = normalizeLockLabel(sourceLabel);
  if (!label) return emptyVisibilityPolicy();

  return enqueueCompendiumWrite(async () => {
    const { policy } = await readPolicyDoc();
    const locked = [...policy.lockedSources];
    if (!locked.some((s) => sourceMatchesLocked(s, label))) {
      locked.push(label);
    }
    const next = { ...policy, lockedSources: locked };
    const lastUpdated = new Date().toISOString();
    return commitPolicyChange(next, lastUpdated);
  });
}

export async function unlockCompendiumSourcesBulk(
  sourceLabels: string[],
): Promise<CompendiumVisibilityPolicy> {
  const labels = [...new Set(sourceLabels.map(normalizeLockLabel).filter(Boolean))];
  if (labels.length === 0) return emptyVisibilityPolicy();

  return enqueueCompendiumWrite(async () => {
    const { policy } = await readPolicyDoc();
    let locked = [...policy.lockedSources];
    for (const label of labels) {
      locked = locked.filter(
        (s) => !sourceMatchesLocked(s, label) && !sourceMatchesLocked(label, s),
      );
    }
    const next = { ...policy, lockedSources: locked };
    const lastUpdated = new Date().toISOString();
    return commitPolicyChange(next, lastUpdated);
  });
}

export async function unlockCompendiumSource(sourceLabel: string): Promise<CompendiumVisibilityPolicy> {
  return unlockCompendiumSourcesBulk([sourceLabel]);
}

export async function publishCompendiumEntry(
  kind: CompendiumKind,
  name: string,
): Promise<CompendiumVisibilityPolicy> {
  const key = publishedEntryKey(kind, name);

  return enqueueCompendiumWrite(async () => {
    const { policy } = await readPolicyDoc();
    const published = [...policy.publishedEntryKeys];
    if (!published.includes(key)) published.push(key);
    const next = { ...policy, publishedEntryKeys: published };
    const lastUpdated = new Date().toISOString();
    return commitPolicyChange(next, lastUpdated);
  });
}

export async function unpublishCompendiumEntry(
  kind: CompendiumKind,
  name: string,
): Promise<CompendiumVisibilityPolicy> {
  const key = publishedEntryKey(kind, name);

  return enqueueCompendiumWrite(async () => {
    const { policy } = await readPolicyDoc();
    const next = {
      ...policy,
      publishedEntryKeys: policy.publishedEntryKeys.filter((k) => k !== key),
    };
    const lastUpdated = new Date().toISOString();
    return commitPolicyChange(next, lastUpdated);
  });
}
