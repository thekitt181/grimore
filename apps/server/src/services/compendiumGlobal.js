import { normalizeOwlbearGlobalDoc } from '@grimoire/shared';
import { getCollection, resetMongoClient, shouldResetMongoClient, withMongoTimeout } from '../lib/mongo';
import { clearGlobalFallbackCache, globalFallbackFileRevision, loadGlobalFallback, loadRawGlobalFallback, saveGlobalFallback, } from './compendiumGlobalFallback';
import { fetchExtensionGlobalDoc, invalidateExtensionGlobalCache } from './compendiumExtensionBridge';
import { notifyCompendiumChanged } from './compendiumChangeNotify';
import { markCompendiumWritePending } from './compendiumMongoWatch';
import { enqueueCompendiumWrite } from './compendiumWriteQueue';
import { getCachedGlobalLite, setCachedGlobalLite, invalidateCompendiumCaches, } from './compendiumCache';
const EMPTY_GLOBAL = {
    _id: 'global',
    monsters: [],
    items: [],
    spells: [],
    deleted: [],
    images: {},
    imagesData: {},
    entryImages: {},
    lastUpdated: new Date(0).toISOString(),
};
function mergeByKey(secondary, primary, keyFn) {
    const map = new Map();
    for (const entry of secondary)
        map.set(keyFn(entry), entry);
    for (const entry of primary)
        map.set(keyFn(entry), entry);
    return Array.from(map.values());
}
function mergeGlobalDocsWithPriority(secondary, primary) {
    return {
        _id: 'global',
        monsters: mergeByKey(secondary.monsters ?? [], primary.monsters ?? [], (m) => m.name.trim().toLowerCase()),
        items: mergeByKey(secondary.items ?? [], primary.items ?? [], (i) => i.name.trim().toLowerCase()),
        spells: mergeByKey(secondary.spells ?? [], primary.spells ?? [], (s) => s.name.toLowerCase()),
        deleted: [...new Set([...(secondary.deleted ?? []), ...(primary.deleted ?? [])])],
        images: { ...(secondary.images ?? {}), ...(primary.images ?? {}) },
        imagesData: { ...(secondary.imagesData ?? {}), ...(primary.imagesData ?? {}) },
        entryImages: { ...(secondary.entryImages ?? {}), ...(primary.entryImages ?? {}) },
        lastUpdated: newestIso(primary.lastUpdated, secondary.lastUpdated),
    };
}
/** Merge two global docs; the doc with the newer lastUpdated wins on conflicts. */
export function mergeGlobalDocs(a, b) {
    const aMs = new Date(a.lastUpdated).getTime();
    const bMs = new Date(b.lastUpdated).getTime();
    if (aMs >= bMs)
        return mergeGlobalDocsWithPriority(b, a);
    return mergeGlobalDocsWithPriority(a, b);
}
export function newestIso(...values) {
    let best = 0;
    for (const v of values) {
        if (v === undefined)
            continue;
        const ms = v instanceof Date ? v.getTime() : new Date(v).getTime();
        if (!Number.isNaN(ms) && ms > best)
            best = ms;
    }
    return new Date(best).toISOString();
}
export function isoTimestamp(value) {
    if (!value)
        return new Date(0).toISOString();
    return value instanceof Date ? value.toISOString() : value;
}
function withFileMtime(doc) {
    const fileRev = globalFallbackFileRevision();
    if (!fileRev)
        return doc;
    const fileMs = new Date(fileRev).getTime();
    const docMs = new Date(doc.lastUpdated).getTime();
    if (fileMs > docMs) {
        return { ...doc, lastUpdated: fileRev };
    }
    return doc;
}
export async function readMongoGlobalDoc(opts = {}) {
    try {
        const col = await getCollection('data');
        if (!col)
            return null;
        // Full read: all fields (images map is ~2MB — needs a longer timeout).
        // Lite read: overrides only — skip image blobs/maps; catalog merge does not need them.
        const projection = opts.includeImageData
            ? undefined
            : { imagesData: 0, images: 0, entryImages: 0 };
        const doc = await withMongoTimeout(col.findOne({ _id: 'global' }, projection ? { projection } : undefined), opts.includeImageData ? 15_000 : 5_000);
        if (!doc)
            return null;
        const normalized = normalizeOwlbearGlobalDoc(doc);
        if (!opts.includeImageData) {
            normalized.images = {};
            normalized.imagesData = {};
            normalized.entryImages = {};
        }
        return normalized;
    }
    catch (err) {
        console.warn('[Compendium] Mongo global read failed, using fallback:', err instanceof Error ? err.message : err);
        if (shouldResetMongoClient(err))
            resetMongoClient();
        return null;
    }
}
let globalDocInflight = null;
async function buildGlobalDoc(opts) {
    const fallbackRaw = loadGlobalFallback(true);
    const fallback = fallbackRaw ? withFileMtime(fallbackRaw) : null;
    const skipExtension = process.env['OWLBear_SKIP_EXTENSION'] === '1';
    const extensionPromise = skipExtension ? Promise.resolve(null) : fetchExtensionGlobalDoc();
    const mongoPromise = readMongoGlobalDoc(opts);
    const [mongo, extension] = await Promise.all([mongoPromise, extensionPromise]);
    let merged = mongo;
    if (merged && extension)
        merged = mergeGlobalDocs(merged, extension);
    else if (!merged && extension)
        merged = extension;
    if (merged && fallback)
        merged = mergeGlobalDocs(merged, fallback);
    else if (!merged && fallback)
        merged = { ...EMPTY_GLOBAL, ...fallback };
    else if (!merged)
        merged = { ...EMPTY_GLOBAL };
    if (!opts.includeImageData) {
        setCachedGlobalLite(merged);
    }
    return merged;
}
/** Merged view: Mongo + Owlbear extension + local data.json (newest source wins per field). */
export async function globalDoc(opts = {}) {
    if (!opts.includeImageData) {
        const cached = getCachedGlobalLite();
        if (cached)
            return cached;
    }
    const key = opts.includeImageData ? 'full' : 'lite';
    if (globalDocInflight?.key === key)
        return globalDocInflight.promise;
    const promise = buildGlobalDoc(opts).finally(() => {
        if (globalDocInflight?.promise === promise)
            globalDocInflight = null;
    });
    globalDocInflight = { key, promise };
    return promise;
}
/** Authoritative global doc for writes — Mongo first, then local file mirror. */
async function readAuthoritativeGlobal(includeImageData) {
    const mongo = await readMongoGlobalDoc({ includeImageData });
    if (mongo)
        return mongo;
    const fallback = loadGlobalFallback(true);
    if (fallback)
        return fallback;
    return { ...EMPTY_GLOBAL };
}
async function persistGlobalDoc(next) {
    const col = await getCollection('data');
    if (col) {
        markCompendiumWritePending();
        const existing = await withMongoTimeout(col.findOne({ _id: 'global' }), 15_000);
        const mongoPayload = {
            _id: 'global',
            monsters: existing?.monsters ?? [],
            items: existing?.items ?? [],
            spells: existing?.spells ?? [],
            overrideMonsters: next.monsters ?? existing?.overrideMonsters ?? [],
            overrideItems: next.items ?? existing?.overrideItems ?? [],
            overrideSpells: next.spells ?? existing?.overrideSpells ?? [],
            deleted: next.deleted ?? existing?.deleted ?? [],
            images: next.images ?? existing?.images ?? {},
            imagesData: next.imagesData ?? existing?.imagesData ?? {},
            entryImages: next.entryImages ?? existing?.entryImages ?? {},
            lastUpdated: next.lastUpdated,
        };
        await withMongoTimeout(col.updateOne({ _id: 'global' }, { $set: mongoPayload }, { upsert: true }), 15_000);
        saveGlobalFallback(normalizeOwlbearGlobalDoc(mongoPayload), mongoPayload);
        notifyCompendiumChanged(next.lastUpdated);
        return normalizeOwlbearGlobalDoc(mongoPayload);
    }
    const saved = saveGlobalFallback(next);
    if (!saved) {
        throw new Error('MongoDB unavailable and no local data.json to write');
    }
    notifyCompendiumChanged(saved.lastUpdated);
    return saved;
}
/**
 * Atomic read-modify-write on the global compendium doc (queued).
 * Reads Mongo directly — never stale extension HTTP cache.
 */
export async function mutateGlobal(apply) {
    return enqueueCompendiumWrite(async () => {
        invalidateExtensionGlobalCache();
        clearGlobalFallbackCache();
        invalidateCompendiumCaches();
        const current = await readAuthoritativeGlobal(true);
        const partial = apply(current);
        const next = {
            ...current,
            ...partial,
            _id: 'global',
            lastUpdated: new Date().toISOString(),
        };
        return persistGlobalDoc(next);
    });
}
/** Persist compendium overrides to MongoDB (primary) and data.json (mirror). */
export async function saveGlobal(partial) {
    return mutateGlobal(() => partial);
}
/** On startup, mirror MongoDB into local data.json (Mongo is source of truth). */
export async function syncCompendiumStorageOnStartup() {
    try {
        const col = await getCollection('data');
        if (!col) {
            console.log('[Compendium] MongoDB not available — writes will use local data.json');
            return;
        }
        invalidateExtensionGlobalCache();
        clearGlobalFallbackCache();
        const mongo = await readMongoGlobalDoc();
        if (!mongo) {
            const fallbackRaw = loadRawGlobalFallback();
            if (fallbackRaw) {
                const payload = { ...fallbackRaw, _id: 'global', lastUpdated: new Date().toISOString() };
                await withMongoTimeout(col.updateOne({ _id: 'global' }, { $set: payload }, { upsert: true }));
                saveGlobalFallback(normalizeOwlbearGlobalDoc(payload), payload);
                console.log('[Compendium] Seeded MongoDB from local data.json');
            }
            return;
        }
        const raw = await withMongoTimeout(col.findOne({ _id: 'global' }), 15_000);
        if (raw) {
            saveGlobalFallback(mongo, raw);
        }
        console.log('[Compendium] MongoDB compendium is up to date');
    }
    catch (err) {
        console.error('[Compendium] Startup sync failed:', err);
    }
}
//# sourceMappingURL=compendiumGlobal.js.map