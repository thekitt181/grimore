import { invalidateExtensionGlobalCache } from './compendiumExtensionBridge';
import { clearGlobalFallbackCache } from './compendiumGlobalFallback';
import { broadcastCompendiumUpdated } from './compendiumBroadcast';
import { invalidateCompendiumCaches } from './compendiumCache';
import { clearRawGlobalDocInflight } from './compendiumOwlbearPersist';
import {
  applyVisibilityPolicyUpdate,
} from './compendiumPolicyCache';
import type { CompendiumVisibilityPolicy } from './compendiumVisibility';

function isoTimestamp(value: string | Date | undefined): string {
  if (!value) return new Date(0).toISOString();
  return value instanceof Date ? value.toISOString() : value;
}

/** Visibility policy changed only — keep merged catalog cache, refresh policy + notify clients. */
export function notifyCompendiumPolicyChanged(
  lastUpdated: string | Date | undefined,
  policy?: CompendiumVisibilityPolicy,
): void {
  if (policy) {
    applyVisibilityPolicyUpdate(policy, isoTimestamp(lastUpdated));
  }
  clearRawGlobalDocInflight();
  broadcastCompendiumUpdated(isoTimestamp(lastUpdated));
}
/** Full compendium data changed — rebuild catalog cache. */
export function notifyCompendiumChanged(lastUpdated: string | Date | undefined): void {
  invalidateCompendiumCaches();
  invalidateExtensionGlobalCache();
  clearGlobalFallbackCache();
  clearRawGlobalDocInflight();
  broadcastCompendiumUpdated(isoTimestamp(lastUpdated));
}
