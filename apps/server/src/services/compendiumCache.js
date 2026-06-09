const GLOBAL_LITE_TTL_MS = 2_000;
let globalLiteCache = null;
const invalidators = [];
export function registerCompendiumCacheInvalidator(fn) {
    invalidators.push(fn);
}
export function invalidateCompendiumCaches() {
    globalLiteCache = null;
    for (const fn of invalidators)
        fn();
}
export function getCachedGlobalLite() {
    if (!globalLiteCache)
        return null;
    if (Date.now() - globalLiteCache.at > GLOBAL_LITE_TTL_MS)
        return null;
    return globalLiteCache.doc;
}
export function setCachedGlobalLite(doc) {
    globalLiteCache = { at: Date.now(), doc };
}
//# sourceMappingURL=compendiumCache.js.map