import { normalizeOwlbearGlobalDoc } from '@grimoire/shared';
let cache = null;
const CACHE_MS = 2_000;
const DOWN_COOLDOWN_MS = 8_000;
const FETCH_TIMEOUT_MS = 1_500;
const VERSION_TIMEOUT_MS = 800;
let extensionDownUntil = 0;
function extensionApiUrl() {
    return (process.env['OWLBear_API_URL'] ?? 'http://localhost:3000').replace(/\/$/, '');
}
export async function fetchExtensionVersion() {
    if (extensionDownUntil > Date.now())
        return null;
    const url = `${extensionApiUrl()}/api/data/version`;
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(VERSION_TIMEOUT_MS) });
        if (!res.ok)
            return null;
        const data = (await res.json());
        return data.lastUpdated ? new Date(data.lastUpdated).toISOString() : null;
    }
    catch {
        // Version probe failure is non-fatal — do not block extension reads for long.
        return null;
    }
}
/** Pull the Owlbear extension global doc (reads Mongo on the extension server). */
export async function fetchExtensionGlobalDoc(force = false) {
    const now = Date.now();
    if (!force && extensionDownUntil > now)
        return null;
    if (!force && cache && now - cache.at < CACHE_MS) {
        return cache.doc;
    }
    const version = force ? null : await fetchExtensionVersion();
    if (!force && version && cache?.version === version && cache.doc) {
        cache = { ...cache, at: now };
        return cache.doc;
    }
    const url = `${extensionApiUrl()}/api/data`;
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        if (!res.ok) {
            extensionDownUntil = now + DOWN_COOLDOWN_MS;
            cache = { at: now, version: null, doc: null };
            return null;
        }
        const raw = (await res.json());
        const doc = normalizeOwlbearGlobalDoc(raw);
        const docVersion = doc.lastUpdated ? new Date(doc.lastUpdated).toISOString() : version;
        cache = { at: now, version: docVersion, doc };
        extensionDownUntil = 0;
        return doc;
    }
    catch {
        extensionDownUntil = now + DOWN_COOLDOWN_MS;
        cache = { at: now, version: null, doc: null };
        return null;
    }
}
export function invalidateExtensionGlobalCache() {
    cache = null;
    extensionDownUntil = 0;
}
//# sourceMappingURL=compendiumExtensionBridge.js.map