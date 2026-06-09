import { normalizeOwlbearGlobalDoc } from '@grimoire/shared';
import { getCollection, withMongoTimeout } from '../lib/mongo';
import { clearGlobalFallbackCache, loadGlobalFallback, loadRawGlobalFallback, saveGlobalFallback, } from './compendiumGlobalFallback';
import { notifyCompendiumChanged } from './compendiumChangeNotify';
import { markCompendiumWritePending } from './compendiumMongoWatch';
import { enqueueCompendiumWrite } from './compendiumWriteQueue';
import { invalidateExtensionGlobalCache } from './compendiumExtensionBridge';
import { invalidateCompendiumCaches } from './compendiumCache';
import { loadLocalItems, loadLocalMonsters, loadLocalSpells, } from './compendiumLocal';
import { compendiumImageKey, toOwlbearMongoImageRef } from '@grimoire/monster-dex';
import { entryNameKey, namesMatch, normalizeEntryName, normalizeOwlbearRawDoc, } from './compendiumMerge';
const KIND_FIELDS = {
    monster: {
        custom: 'monsters',
        override: 'overrideMonsters',
    },
    item: {
        custom: 'items',
        override: 'overrideItems',
    },
    spell: {
        custom: 'spells',
        override: 'overrideSpells',
    },
};
const EMPTY_RAW = {
    _id: 'global',
    monsters: [],
    items: [],
    spells: [],
    overrideMonsters: [],
    overrideItems: [],
    overrideSpells: [],
    deleted: [],
    images: {},
    imagesData: {},
    entryImages: {},
    lastUpdated: new Date(0).toISOString(),
};
function normalizeEntryImageField(entry) {
    if (!entry.image)
        return entry;
    return { ...entry, image: toOwlbearMongoImageRef(entry.image) };
}
function normalizeRawDocImages(raw) {
    if (raw.images) {
        const next = {};
        for (const [key, value] of Object.entries(raw.images)) {
            next[key] = toOwlbearMongoImageRef(value);
        }
        raw.images = next;
    }
    if (raw.entryImages) {
        for (const [name, urls] of Object.entries(raw.entryImages)) {
            raw.entryImages[name] = urls.map((url) => toOwlbearMongoImageRef(url));
        }
    }
    for (const field of [
        'monsters',
        'items',
        'spells',
        'overrideMonsters',
        'overrideItems',
        'overrideSpells',
    ]) {
        const list = raw[field];
        if (Array.isArray(list)) {
            raw[field] = list.map(normalizeEntryImageField);
        }
    }
}
function normalizeRawDoc(raw) {
    const merged = normalizeOwlbearRawDoc({
        ...EMPTY_RAW,
        ...raw,
        _id: 'global',
        monsters: raw.monsters ?? [],
        items: raw.items ?? [],
        spells: raw.spells ?? [],
        overrideMonsters: raw.overrideMonsters ?? [],
        overrideItems: raw.overrideItems ?? [],
        overrideSpells: raw.overrideSpells ?? [],
        deleted: raw.deleted ?? [],
        images: raw.images ?? {},
        imagesData: raw.imagesData ?? {},
        entryImages: raw.entryImages ?? {},
    });
    normalizeRawDocImages(merged);
    return merged;
}
function rawPersistFingerprint(raw) {
    return JSON.stringify({
        monsters: raw.monsters,
        items: raw.items,
        spells: raw.spells,
        overrideMonsters: raw.overrideMonsters,
        overrideItems: raw.overrideItems,
        overrideSpells: raw.overrideSpells,
        deleted: raw.deleted,
        images: raw.images,
        imagesData: raw.imagesData,
        entryImages: raw.entryImages,
    });
}
function getList(raw, field) {
    const val = raw[field];
    return Array.isArray(val) ? [...val] : [];
}
function setList(raw, field, list) {
    raw[field] = list;
}
function findBuiltInByName(kind, name) {
    const target = normalizeEntryName(name);
    if (!target)
        return null;
    if (kind === 'monster') {
        return loadLocalMonsters().find((m) => namesMatch(m.name, target)) ?? null;
    }
    if (kind === 'item') {
        return loadLocalItems().find((i) => namesMatch(i.name, target)) ?? null;
    }
    return loadLocalSpells().find((s) => namesMatch(s.name, target)) ?? null;
}
function isBuiltInEntry(kind, name) {
    return Boolean(findBuiltInByName(kind, name));
}
function applySourceBookOrigin(entry, kind, originName) {
    const lookupName = originName || entry.originBookName || entry.name;
    const builtIn = findBuiltInByName(kind, lookupName);
    if (!builtIn)
        return entry;
    const merged = { ...builtIn, ...entry, name: entry.name };
    if (builtIn.source)
        merged.source = builtIn.source;
    else if (entry.source && entry.source !== 'Custom')
        merged.source = entry.source;
    const bookOrigin = originName || entry.originBookName;
    if (bookOrigin && !namesMatch(bookOrigin, entry.name) && isBuiltInEntry(kind, bookOrigin)) {
        merged.originBookName = normalizeEntryName(bookOrigin);
    }
    else if (entry.originBookName) {
        merged.originBookName = normalizeEntryName(entry.originBookName);
    }
    return merged;
}
function resolveOriginName(kind, entry, previousName) {
    if (previousName && isBuiltInEntry(kind, previousName)) {
        return normalizeEntryName(previousName);
    }
    if (isBuiltInEntry(kind, entry.name)) {
        return normalizeEntryName(entry.name);
    }
    if (previousName)
        return normalizeEntryName(previousName);
    return null;
}
function upsertEntry(list, entry) {
    const key = entryNameKey(entry.name);
    const idx = list.findIndex((e) => entryNameKey(e.name) === key);
    if (idx >= 0) {
        const next = [...list];
        next[idx] = entry;
        return next;
    }
    return [...list, entry];
}
function removeEntry(list, name) {
    return list.filter((e) => !namesMatch(e.name, name));
}
function filterCustomDuplicates(customs, entry, originName) {
    return customs.filter((e) => !namesMatch(e.name, entry.name)
        && !(entry.originBookName && namesMatch(e.name, entry.originBookName))
        && !(originName && namesMatch(e.name, originName)));
}
function addDeleted(raw, name, kind) {
    const builtIn = findBuiltInByName(kind, name);
    const canonical = builtIn?.name ?? normalizeEntryName(name);
    const deleted = [...(raw.deleted ?? [])];
    if (!deleted.some((d) => namesMatch(d, canonical))) {
        deleted.push(canonical);
        raw.deleted = deleted;
    }
}
function hideBuiltInOriginal(raw, kind, originName) {
    if (!originName || !isBuiltInEntry(kind, originName))
        return;
    addDeleted(raw, originName, kind);
}
/** Dedupe overrides and strip stale custom copies in Mongo/data.json. */
export async function reconcileRawGlobalStorage() {
    try {
        const col = await getCollection('data');
        if (!col)
            return;
        const doc = await withMongoTimeout(col.findOne({ _id: 'global' }), 15_000);
        if (!doc)
            return;
        const cleaned = normalizeRawDoc(doc);
        if (rawPersistFingerprint(doc) === rawPersistFingerprint(cleaned))
            return;
        await persistRawGlobalDoc(cleaned);
        console.log('[Compendium] Reconciled compendium data in MongoDB');
    }
    catch (err) {
        console.warn('[Compendium] Mongo reconcile skipped:', err instanceof Error ? err.message : err);
    }
}
/** Read the raw Owlbear Mongo/fallback doc (override* arrays intact). */
export async function readRawGlobalDoc() {
    try {
        const col = await getCollection('data');
        if (col) {
            const doc = await withMongoTimeout(col.findOne({ _id: 'global' }), 15_000);
            if (doc)
                return normalizeRawDoc(doc);
        }
    }
    catch (err) {
        console.warn('[Compendium] Raw Mongo read failed, trying fallback:', err instanceof Error ? err.message : err);
    }
    const fallbackRaw = loadRawGlobalFallback();
    if (fallbackRaw)
        return normalizeRawDoc(fallbackRaw);
    const normalized = loadGlobalFallback(true);
    if (normalized) {
        return normalizeRawDoc({
            ...normalized,
            monsters: [],
            items: [],
            spells: [],
            overrideMonsters: normalized.monsters,
            overrideItems: normalized.items,
            overrideSpells: normalized.spells,
        });
    }
    return { ...EMPTY_RAW };
}
export async function persistRawGlobalDoc(raw) {
    const lastUpdated = new Date().toISOString();
    const payload = normalizeRawDoc({ ...raw, lastUpdated });
    const col = await getCollection('data');
    if (col) {
        markCompendiumWritePending();
        await withMongoTimeout(col.updateOne({ _id: 'global' }, { $set: payload }, { upsert: true }), 15_000);
    }
    const normalized = normalizeOwlbearGlobalDoc(payload);
    const saved = saveGlobalFallback(normalized, payload);
    if (!col && !saved) {
        throw new Error('MongoDB unavailable and no local data.json to write');
    }
    notifyCompendiumChanged(lastUpdated);
    return normalized;
}
function invalidateWriteCaches() {
    invalidateExtensionGlobalCache();
    clearGlobalFallbackCache();
    invalidateCompendiumCaches();
}
/** Save a compendium entry in Owlbear-native Mongo format (override* vs custom arrays). */
export async function saveOwlbearEntry(kind, entry, opts) {
    return enqueueCompendiumWrite(async () => {
        invalidateWriteCaches();
        const raw = await readRawGlobalDoc();
        const fields = KIND_FIELDS[kind];
        const prepared = { ...entry };
        const imageKey = compendiumImageKey(kind, prepared.name);
        if (raw.images?.[imageKey]) {
            prepared.image = toOwlbearMongoImageRef(raw.images[imageKey]);
        }
        else if (prepared.image) {
            prepared.image = toOwlbearMongoImageRef(prepared.image);
        }
        if (opts.saveAs === 'replace') {
            const originName = resolveOriginName(kind, prepared, opts.previousName);
            const overrideEntry = applySourceBookOrigin(prepared, kind, originName);
            if (opts.previousName && !namesMatch(opts.previousName, overrideEntry.name)) {
                hideBuiltInOriginal(raw, kind, opts.previousName);
                setList(raw, fields.override, removeEntry(getList(raw, fields.override), opts.previousName));
                setList(raw, fields.custom, removeEntry(getList(raw, fields.custom), opts.previousName));
                if (opts.hidePrevious)
                    addDeleted(raw, opts.previousName, kind);
            }
            setList(raw, fields.override, upsertEntry(getList(raw, fields.override), overrideEntry));
            setList(raw, fields.custom, filterCustomDuplicates(getList(raw, fields.custom), overrideEntry, originName));
            hideBuiltInOriginal(raw, kind, originName);
            if (overrideEntry.originBookName) {
                hideBuiltInOriginal(raw, kind, overrideEntry.originBookName);
            }
        }
        else {
            const customEntry = { ...prepared, source: 'Custom' };
            if (opts.previousName && !namesMatch(opts.previousName, customEntry.name)) {
                setList(raw, fields.override, removeEntry(getList(raw, fields.override), opts.previousName));
                setList(raw, fields.custom, removeEntry(getList(raw, fields.custom), opts.previousName));
            }
            setList(raw, fields.override, removeEntry(getList(raw, fields.override), customEntry.name));
            setList(raw, fields.custom, upsertEntry(getList(raw, fields.custom), customEntry));
        }
        return persistRawGlobalDoc(raw);
    });
}
/** Delete/hide a compendium entry using Owlbear-native storage. */
export async function deleteOwlbearEntry(kind, name, opts) {
    return enqueueCompendiumWrite(async () => {
        invalidateWriteCaches();
        const raw = await readRawGlobalDoc();
        const fields = KIND_FIELDS[kind];
        const inCustom = getList(raw, fields.custom).some((e) => namesMatch(e.name, name));
        const inOverride = getList(raw, fields.override).some((e) => namesMatch(e.name, name));
        const customOnly = inCustom && !opts.inBaseCatalog && !inOverride;
        if (customOnly) {
            setList(raw, fields.custom, removeEntry(getList(raw, fields.custom), name));
        }
        else {
            addDeleted(raw, name, kind);
            setList(raw, fields.override, removeEntry(getList(raw, fields.override), name));
            setList(raw, fields.custom, removeEntry(getList(raw, fields.custom), name));
        }
        return persistRawGlobalDoc(raw);
    });
}
/** Patch image fields on the raw doc without flattening override/custom structure. */
export async function saveOwlbearImageFields(patch, entryPatch) {
    return enqueueCompendiumWrite(async () => {
        invalidateWriteCaches();
        const raw = await readRawGlobalDoc();
        raw.images = patch.images ?? raw.images ?? {};
        raw.imagesData = patch.imagesData ?? raw.imagesData ?? {};
        raw.entryImages = patch.entryImages ?? raw.entryImages ?? {};
        if (entryPatch) {
            const fields = KIND_FIELDS[entryPatch.kind];
            const applyImage = (list) => {
                const idx = list.findIndex((e) => namesMatch(e.name, entryPatch.name));
                if (idx < 0)
                    return list;
                const next = [...list];
                const entry = { ...next[idx] };
                if (entryPatch.image)
                    entry.image = toOwlbearMongoImageRef(entryPatch.image);
                else
                    delete entry.image;
                next[idx] = entry;
                return next;
            };
            setList(raw, fields.override, applyImage(getList(raw, fields.override)));
            setList(raw, fields.custom, applyImage(getList(raw, fields.custom)));
        }
        return persistRawGlobalDoc(raw);
    });
}
//# sourceMappingURL=compendiumOwlbearPersist.js.map