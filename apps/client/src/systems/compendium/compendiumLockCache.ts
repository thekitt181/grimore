import type { QueryClient } from '@tanstack/react-query';
import { ensureApiAuthToken } from '@/lib/axios';
import type {
  CompendiumItem,
  CompendiumMonster,
  CompendiumSearchResult,
  CompendiumSource,
  CompendiumSpell,
  CompendiumVisibilityPolicy,
} from '@grimoire/shared';

function normalizeSourceKey(label: string): string {
  return label
    .trim()
    .replace(/\.pdf$/i, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function sourceIdsMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a.trim().toLowerCase() === b.trim().toLowerCase()) return true;
  return normalizeSourceKey(a) === normalizeSourceKey(b);
}

function sourceIsLockedInPolicy(sourceId: string, policy: CompendiumVisibilityPolicy): boolean {
  return policy.lockedSources.some((locked) => sourceIdsMatch(locked, sourceId));
}

function entryFromLockedSource(
  source: string | undefined,
  policy: CompendiumVisibilityPolicy,
): boolean {
  if (!source?.trim() || policy.lockedSources.length === 0) return false;
  return source.split(/,\s*/).some((part) => sourceIsLockedInPolicy(part, policy));
}

export function patchCompendiumVisibilityPolicy(
  qc: QueryClient,
  policy: CompendiumVisibilityPolicy,
): void {
  qc.setQueryData(['compendium', 'visibility-policy'], policy);
}

export function patchCompendiumSourceLock(
  qc: QueryClient,
  sourceId: string,
  locked: boolean,
): void {
  for (const kind of ['monsters', 'items', 'spells'] as const) {
    qc.setQueriesData<CompendiumSource[]>(
      { queryKey: ['compendium', 'sources', kind] },
      (old) => {
        if (!old) return old;
        return old.map((s) => {
          if (!sourceIdsMatch(s.id, sourceId)) return s;
          return {
            ...s,
            locked,
            ...(locked ? { draftCount: s.count } : { draftCount: 0 }),
          };
        });
      },
    );
  }
}

function patchSearchResults<T extends { source?: string; isDraft?: boolean }>(
  qc: QueryClient,
  scope: 'monsters' | 'items' | 'spells',
  policy: CompendiumVisibilityPolicy,
  includeDrafts: boolean,
): void {
  qc.setQueriesData<{
    pages: CompendiumSearchResult<T>[];
    pageParams: unknown[];
  }>(
    { queryKey: ['compendium', scope] },
    (old) => {
      if (!old?.pages) return old;
      return {
        ...old,
        pages: old.pages.map((page) => {
          const items = page.items
            .map((entry) => {
              const draft = entryFromLockedSource(entry.source, policy);
              return draft ? { ...entry, isDraft: true } : { ...entry, isDraft: false };
            })
            .filter((entry) => includeDrafts || !entry.isDraft);
          return { ...page, items };
        }),
      };
    },
  );
}

export function applyCompendiumLockPolicy(
  qc: QueryClient,
  policy: CompendiumVisibilityPolicy,
  sourceId: string,
  locked: boolean,
  includeDrafts: boolean,
): void {
  patchCompendiumVisibilityPolicy(qc, policy);
  patchCompendiumSourceLock(qc, sourceId, locked);
  patchSearchResults<CompendiumMonster>(qc, 'monsters', policy, includeDrafts);
  patchSearchResults<CompendiumItem>(qc, 'items', policy, includeDrafts);
  patchSearchResults<CompendiumSpell>(qc, 'spells', policy, includeDrafts);
}

export async function refetchCompendiumAfterLock(qc: QueryClient): Promise<void> {
  await qc.refetchQueries({
    predicate: (query) => query.queryKey[0] === 'compendium',
    type: 'active',
  });
}

/** Wait for catalog to be ready after DDB import (server rebuilds before responding). */
export async function refetchCompendiumAfterImport(
  qc: QueryClient,
  opts?: { catalogRev?: string },
): Promise<void> {
  await ensureApiAuthToken({ attempts: 5, delayMs: 500 });
  await qc.invalidateQueries({
    predicate: (query) => query.queryKey[0] === 'compendium',
  });
  await qc.refetchQueries({
    predicate: (query) => query.queryKey[0] === 'compendium',
  });

  if (!opts?.catalogRev) return;

  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    const status = qc.getQueryData<{ catalogRev?: string }>(['compendium', 'sync-status']);
    if (status?.catalogRev === opts.catalogRev) return;
    await qc.refetchQueries({ queryKey: ['compendium', 'sync-status'] });
    await new Promise((r) => setTimeout(r, 400));
  }
}
