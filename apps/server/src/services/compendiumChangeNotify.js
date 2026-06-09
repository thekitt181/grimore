import { invalidateExtensionGlobalCache } from './compendiumExtensionBridge';
import { clearGlobalFallbackCache } from './compendiumGlobalFallback';
import { broadcastCompendiumUpdated } from './compendiumBroadcast';
import { invalidateCompendiumCaches } from './compendiumCache';
function isoTimestamp(value) {
    if (!value)
        return new Date(0).toISOString();
    return value instanceof Date ? value.toISOString() : value;
}
/** Invalidate server caches and push compendium:updated to all connected VTT clients. */
export function notifyCompendiumChanged(lastUpdated) {
    invalidateCompendiumCaches();
    invalidateExtensionGlobalCache();
    clearGlobalFallbackCache();
    broadcastCompendiumUpdated(isoTimestamp(lastUpdated));
}
//# sourceMappingURL=compendiumChangeNotify.js.map