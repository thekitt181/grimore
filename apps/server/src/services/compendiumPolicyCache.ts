import { isoTimestamp } from './compendiumGlobal';
import { isCompendiumStorageUnavailable, readCompendiumPolicyFields } from './compendiumPostgres';
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
  if (isCompendiumStorageUnavailable()) {
    const { readRawGlobalDoc } = await import('./compendiumOwlbearPersist');
    const raw = await readRawGlobalDoc({ includeImageData: false });
    const policy = policyFromRaw(raw);
    policyCache = {
      rev: `${isoTimestamp(raw.lastUpdated)}:${policyCacheRev(policy)}:circuit`,
      policy,
    };
    return policy;
  }

  try {
    const meta = await readCompendiumPolicyFields();
    if (meta) {
      const policy = {
        lockedSources: meta.lockedSources,
        publishedEntryKeys: meta.publishedEntryKeys,
      };
      const rev = `${isoTimestamp(meta.lastUpdated)}:${policyCacheRev(policy)}`;
      policyCache = { rev, policy };
      return policy;
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
  setVisibilityPolicyCache(policy, lastUpdated);
}

export function setVisibilityPolicyCache(
  policy: CompendiumVisibilityPolicy,
  lastUpdated: string,
): void {
  policyCache = {
    rev: `${isoTimestamp(lastUpdated)}:${policyCacheRev(policy)}`,
    policy,
  };
  catalogPolicySink?.patch(policy, lastUpdated);
}

export function getCachedVisibilityPolicy(): CompendiumVisibilityPolicy | null {
  return policyCache?.policy ?? null;
}
