import type { OwlbearRawGlobalDoc } from '@grimoire/shared';
import { getCollection, withMongoTimeout } from '../lib/mongo';
import { isoTimestamp } from './compendiumGlobal';
import {
  policyFromRaw,
  type CompendiumVisibilityPolicy,
} from './compendiumVisibility';

let policyCache: { rev: string; policy: CompendiumVisibilityPolicy } | null = null;

type CatalogPolicySink = {
  patch: (policy: CompendiumVisibilityPolicy, lastUpdated: string) => void;
};

let catalogPolicySink: CatalogPolicySink | null = null;

export function registerCatalogPolicySink(sink: CatalogPolicySink): void {
  catalogPolicySink = sink;
}

export function invalidateVisibilityPolicyCache(): void {
  policyCache = null;
}

function policyCacheRev(policy: CompendiumVisibilityPolicy): string {
  return `${policy.lockedSources.join('\0')}::${policy.publishedEntryKeys.join('\0')}`;
}

/** Read only visibility policy fields — avoids loading the full multi-MB global doc. */
export async function readVisibilityPolicyFast(): Promise<CompendiumVisibilityPolicy> {
  if (policyCache) return policyCache.policy;

  try {
    const col = await getCollection<OwlbearRawGlobalDoc>('data');
    if (col) {
      const doc = await withMongoTimeout(
        col.findOne(
          { _id: 'global' },
          { projection: { lockedSources: 1, publishedEntryKeys: 1, lastUpdated: 1 } },
        ),
        10_000,
      );
      if (doc) {
        const policy = policyFromRaw(doc);
        const rev = `${isoTimestamp(doc.lastUpdated)}:${policyCacheRev(policy)}`;
        policyCache = { rev, policy };
        return policy;
      }
    }
  } catch {
    // fall through to full raw read
  }

  const { readRawGlobalDoc } = await import('./compendiumOwlbearPersist');
  const raw = await readRawGlobalDoc({ includeImageData: false });
  const policy = policyFromRaw(raw);
  policyCache = {
    rev: `${isoTimestamp(raw.lastUpdated)}:${policyCacheRev(policy)}`,
    policy,
  };
  return policy;
}

export function applyVisibilityPolicyUpdate(
  policy: CompendiumVisibilityPolicy,
  lastUpdated: string,
): void {
  policyCache = {
    rev: `${lastUpdated}:${policyCacheRev(policy)}`,
    policy,
  };
  catalogPolicySink?.patch(policy, lastUpdated);
}

export function setVisibilityPolicyCache(policy: CompendiumVisibilityPolicy, lastUpdated: string): void {
  applyVisibilityPolicyUpdate(policy, lastUpdated);
}
