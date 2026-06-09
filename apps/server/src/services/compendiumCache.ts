import type { CompendiumGlobalDoc } from '@grimoire/shared';

const GLOBAL_LITE_TTL_MS = 60_000;

let globalLiteCache: { at: number; doc: CompendiumGlobalDoc } | null = null;
const invalidators: Array<() => void> = [];

export function registerCompendiumCacheInvalidator(fn: () => void): void {
  invalidators.push(fn);
}

export function invalidateCompendiumCaches(): void {
  globalLiteCache = null;
  for (const fn of invalidators) fn();
}

export function getCachedGlobalLite(): CompendiumGlobalDoc | null {
  if (!globalLiteCache) return null;
  if (Date.now() - globalLiteCache.at > GLOBAL_LITE_TTL_MS) return null;
  return globalLiteCache.doc;
}

export function setCachedGlobalLite(doc: CompendiumGlobalDoc): void {
  globalLiteCache = { at: Date.now(), doc };
}
