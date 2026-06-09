import { isHomebrewEntry, splitCompendiumSources } from '@grimoire/shared';
import { isLikelyValidItem, parseCr, slugify } from '@grimoire/monster-dex';
import { getCollection, withMongoTimeout, resetMongoClient } from '../lib/mongo';
import { resolveEntryImageUrl } from './compendiumImages';
import { isLocalCatalogAvailable, loadLocalItems, loadLocalMonsters, loadLocalSpells, } from './compendiumLocal';
import { loadGlobalFallback, globalFallbackFileRevision } from './compendiumGlobalFallback';
import { fetchExtensionVersion } from './compendiumExtensionBridge';
import { globalDoc, readMongoGlobalDoc, newestIso, isoTimestamp, } from './compendiumGlobal';
import { saveOwlbearEntry, deleteOwlbearEntry, readRawGlobalDoc } from './compendiumOwlbearPersist';
import { dedupeByEntryName, entryNameKey, filterCustomEntries, isHiddenBuiltIn, namesMatch, } from './compendiumMerge';
import { registerCompendiumCacheInvalidator } from './compendiumCache';
function toMonster(entry, isCustom, global, lite = false) {
    const base = {
        id: entry._id,
        name: entry.name,
        type: entry.type,
        source: entry.source,
        hp: entry.hp,
        ac: entry.ac,
        cr: String(entry.cr),
        description: entry.description,
        ...(entry.image ? { image: entry.image } : {}),
        ...(entry.stats ? { stats: entry.stats } : {}),
        isCustom,
    };
    if (global && !lite) {
        const imageUrl = resolveEntryImageUrl(global, 'monster', entry.name, entry.image);
        if (imageUrl)
            base.imageUrl = imageUrl;
    }
    return base;
}
function mergeMonsters(base, overrides, customs, deleted, global, lite = false) {
    const activeOverrides = dedupeByEntryName(overrides);
    const activeCustoms = filterCustomEntries('monster', customs, activeOverrides, deleted);
    const out = new Map();
    for (const b of base) {
        if (isHiddenBuiltIn(b.name, activeOverrides, deleted))
            continue;
        const ov = activeOverrides.find((o) => namesMatch(o.name, b.name));
        const merged = ov ? { ...b, ...ov } : b;
        out.set(entryNameKey(b.name), toMonster({ ...merged, _id: b._id }, isHomebrewEntry(Boolean(ov), merged.source), global, lite));
    }
    for (const ov of activeOverrides) {
        if (deleted.some((d) => namesMatch(d, ov.name)))
            continue;
        const key = entryNameKey(ov.name);
        if (out.has(key))
            continue;
        out.set(key, toMonster({ ...ov, _id: slugify(ov.name) }, isHomebrewEntry(true, ov.source), global, lite));
    }
    for (const c of activeCustoms) {
        if (deleted.some((d) => namesMatch(d, c.name)))
            continue;
        const key = entryNameKey(c.name);
        if (out.has(key))
            continue;
        out.set(key, toMonster({ ...c, _id: slugify(c.name) }, true, global, lite));
    }
    return Array.from(out.values());
}
function mergeItems(base, overrides, customs, deleted, global, lite = false) {
    const activeOverrides = dedupeByEntryName(overrides);
    const activeCustoms = filterCustomEntries('item', customs, activeOverrides, deleted);
    const out = new Map();
    for (const b of base) {
        if (isHiddenBuiltIn(b.name, activeOverrides, deleted))
            continue;
        const ov = activeOverrides.find((o) => namesMatch(o.name, b.name));
        const merged = ov ? { ...b, ...ov } : b;
        const item = {
            id: b._id,
            name: merged.name,
            type: merged.type,
            source: merged.source,
            description: merged.description,
            ...(merged.rarity ? { rarity: merged.rarity } : {}),
            ...(merged.flavor ? { flavor: merged.flavor } : {}),
            ...(merged.details ? { details: merged.details } : {}),
            ...(merged.image ? { image: merged.image } : {}),
            isCustom: isHomebrewEntry(Boolean(ov ?? b.isCustom), merged.source),
        };
        if (global && !lite) {
            const imageUrl = resolveEntryImageUrl(global, 'item', merged.name, merged.image);
            if (imageUrl)
                item.imageUrl = imageUrl;
        }
        out.set(entryNameKey(b.name), item);
    }
    for (const ov of activeOverrides) {
        if (deleted.some((d) => namesMatch(d, ov.name)))
            continue;
        const key = entryNameKey(ov.name);
        if (out.has(key))
            continue;
        const item = {
            id: slugify(ov.name),
            ...ov,
            isCustom: isHomebrewEntry(true, ov.source),
        };
        if (global && !lite) {
            const imageUrl = resolveEntryImageUrl(global, 'item', ov.name, ov.image);
            if (imageUrl)
                item.imageUrl = imageUrl;
        }
        out.set(key, item);
    }
    for (const c of activeCustoms) {
        if (deleted.some((d) => namesMatch(d, c.name)))
            continue;
        const key = entryNameKey(c.name);
        if (out.has(key))
            continue;
        const item = {
            id: slugify(c.name),
            ...c,
            isCustom: true,
        };
        if (global && !lite) {
            const imageUrl = resolveEntryImageUrl(global, 'item', c.name, c.image);
            if (imageUrl)
                item.imageUrl = imageUrl;
        }
        out.set(key, item);
    }
    return Array.from(out.values());
}
function mergeSpells(base, overrides, customs, deleted, global, lite = false) {
    const activeOverrides = dedupeByEntryName(overrides);
    const activeCustoms = filterCustomEntries('spell', customs, activeOverrides, deleted);
    const out = new Map();
    for (const b of base) {
        if (isHiddenBuiltIn(b.name, activeOverrides, deleted))
            continue;
        const ov = activeOverrides.find((o) => namesMatch(o.name, b.name));
        const merged = ov ? { ...b, ...ov } : b;
        const spell = {
            id: b._id,
            name: merged.name,
            level: merged.level,
            ...(merged.damage ? { damage: merged.damage } : {}),
            ...(merged.type ? { type: merged.type } : {}),
            ...(merged.save ? { save: merged.save } : {}),
            ...(merged.aoe ? { aoe: merged.aoe } : {}),
            ...(merged.attack !== undefined ? { attack: merged.attack } : {}),
            ...(merged.secondary ? { secondary: merged.secondary } : {}),
            ...(merged.description ? { description: merged.description } : {}),
            ...(merged.source ? { source: merged.source } : {}),
            isCustom: isHomebrewEntry(Boolean(ov ?? b.isCustom), merged.source),
        };
        if (global && !lite) {
            const imageUrl = resolveEntryImageUrl(global, 'spell', merged.name, undefined);
            if (imageUrl)
                spell.imageUrl = imageUrl;
        }
        out.set(entryNameKey(b.name), spell);
    }
    for (const ov of activeOverrides) {
        if (deleted.some((d) => namesMatch(d, ov.name)))
            continue;
        const key = entryNameKey(ov.name);
        if (out.has(key))
            continue;
        const spell = {
            id: slugify(ov.name),
            ...ov,
            isCustom: isHomebrewEntry(true, ov.source),
        };
        if (global && !lite) {
            const imageUrl = resolveEntryImageUrl(global, 'spell', ov.name, undefined);
            if (imageUrl)
                spell.imageUrl = imageUrl;
        }
        out.set(key, spell);
    }
    for (const c of activeCustoms) {
        if (deleted.some((d) => namesMatch(d, c.name)))
            continue;
        const key = entryNameKey(c.name);
        if (out.has(key))
            continue;
        const spell = {
            id: slugify(c.name),
            ...c,
            isCustom: true,
        };
        if (global && !lite) {
            const imageUrl = resolveEntryImageUrl(global, 'spell', c.name, undefined);
            if (imageUrl)
                spell.imageUrl = imageUrl;
        }
        out.set(key, spell);
    }
    return Array.from(out.values());
}
function filterMonsters(list, q, crMin, crMax) {
    const lower = q.trim().toLowerCase();
    return list.filter((m) => {
        if (lower && !m.name.toLowerCase().includes(lower) && !m.description.toLowerCase().includes(lower)) {
            return false;
        }
        const cr = parseCr(m.cr);
        if (crMin !== undefined && cr < crMin)
            return false;
        if (crMax !== undefined && cr > crMax)
            return false;
        return true;
    });
}
function paginate(list, page, limit) {
    const start = (page - 1) * limit;
    return {
        items: list.slice(start, start + limit),
        total: list.length,
        page,
        limit,
    };
}
/** Prefer fast local JSON catalog; Mongo collection is homebrew-only fallback. */
async function loadBaseMonsters() {
    const local = loadLocalMonsters();
    if (local.length > 0)
        return local;
    try {
        const col = await getCollection('monsters');
        if (!col)
            return [];
        return await withMongoTimeout(col.find({}).limit(10_000).toArray());
    }
    catch {
        resetMongoClient();
        return loadLocalMonsters();
    }
}
async function loadBaseItems() {
    const local = loadLocalItems();
    if (local.length > 0)
        return local;
    try {
        const col = await getCollection('items');
        if (!col)
            return [];
        return await withMongoTimeout(col.find({}).limit(10_000).toArray());
    }
    catch {
        resetMongoClient();
        return loadLocalItems();
    }
}
async function loadBaseSpells() {
    const local = loadLocalSpells();
    if (local.length > 0)
        return local;
    try {
        const col = await getCollection('spells');
        if (!col)
            return [];
        return await withMongoTimeout(col.find({}).limit(10_000).toArray());
    }
    catch {
        resetMongoClient();
        return loadLocalSpells();
    }
}
let catalogCache = null;
let catalogBuildPromise = null;
function invalidateCatalogCache() {
    catalogCache = null;
    catalogBuildPromise = null;
}
async function buildCatalogCache() {
    const [raw, global] = await Promise.all([readRawGlobalDoc(), globalDoc()]);
    const rev = isoTimestamp(global.lastUpdated);
    if (catalogCache?.rev === rev)
        return catalogCache;
    if (catalogBuildPromise)
        return catalogBuildPromise;
    const deleted = raw.deleted ?? [];
    catalogBuildPromise = (async () => {
        const [monsters, items, spells] = await Promise.all([
            mergeMonsters(await loadBaseMonsters(), raw.overrideMonsters ?? [], raw.monsters ?? [], deleted, global, true),
            mergeItems(await loadBaseItems(), raw.overrideItems ?? [], raw.items ?? [], deleted, global, true),
            mergeSpells(await loadBaseSpells(), raw.overrideSpells ?? [], raw.spells ?? [], deleted, global, true),
        ]);
        monsters.sort((a, b) => a.name.localeCompare(b.name));
        items.sort((a, b) => a.name.localeCompare(b.name));
        spells.sort((a, b) => a.name.localeCompare(b.name));
        catalogCache = { rev, monsters, items, spells };
        catalogBuildPromise = null;
        return catalogCache;
    })();
    return catalogBuildPromise;
}
async function getCachedMonsters() {
    return (await buildCatalogCache()).monsters;
}
async function getCachedItems() {
    return (await buildCatalogCache()).items;
}
async function getCachedSpells() {
    return (await buildCatalogCache()).spells;
}
/** Pre-build merged catalogs on server start so first search is instant. */
export async function warmCompendiumCatalog() {
    try {
        const cache = await buildCatalogCache();
        console.log(`[Compendium] Catalog warmed: ${cache.monsters.length} monsters, ${cache.items.length} items, ${cache.spells.length} spells`);
    }
    catch (err) {
        console.warn('[Compendium] Catalog warm failed:', err);
    }
}
registerCompendiumCacheInvalidator(invalidateCatalogCache);
/** Human-readable label for a raw source string (PDF filename, etc.). */
export function formatSourceLabel(raw) {
    let label = raw.trim();
    label = label.replace(/\.pdf$/i, '').replace(/\.PDF$/i, '');
    label = label.replace(/_/g, ' ');
    label = label.replace(/\s+/g, ' ').trim();
    return label || raw;
}
function splitSources(source) {
    return splitCompendiumSources(source);
}
function entryMatchesSource(source, filterSource) {
    return splitSources(source).some((p) => p === filterSource);
}
function resolveSaveAs(entry, opts) {
    if (opts?.saveAs)
        return opts.saveAs;
    const parts = splitSources(entry.source);
    if (parts.length > 0 && !parts.every((p) => p.toLowerCase() === 'custom')) {
        return 'replace';
    }
    return 'homebrew';
}
function prepareSavePayload(entry, saveAs) {
    if (saveAs === 'homebrew') {
        return { ...entry, source: 'Custom' };
    }
    return { ...entry, source: entry.source?.trim() ? entry.source : 'Custom' };
}
export async function listSources(kind) {
    if (kind === 'monsters') {
        const merged = await getCachedMonsters();
        const counts = new Map();
        for (const m of merged) {
            if (isHomebrewEntry(m.isCustom, m.source))
                continue;
            for (const part of splitSources(m.source)) {
                if (part.toLowerCase() === 'custom')
                    continue;
                counts.set(part, (counts.get(part) ?? 0) + 1);
            }
        }
        return Array.from(counts.entries())
            .map(([id, count]) => ({ id, label: formatSourceLabel(id), count }))
            .sort((a, b) => a.label.localeCompare(b.label));
    }
    if (kind === 'items') {
        const merged = await getCachedItems();
        const counts = new Map();
        for (const i of merged) {
            if (isHomebrewEntry(i.isCustom, i.source))
                continue;
            for (const part of splitSources(i.source)) {
                if (part.toLowerCase() === 'custom')
                    continue;
                counts.set(part, (counts.get(part) ?? 0) + 1);
            }
        }
        return Array.from(counts.entries())
            .map(([id, count]) => ({ id, label: formatSourceLabel(id), count }))
            .sort((a, b) => a.label.localeCompare(b.label));
    }
    const merged = await getCachedSpells();
    const counts = new Map();
    for (const s of merged) {
        if (isHomebrewEntry(s.isCustom, s.source))
            continue;
        for (const part of splitSources(s.source)) {
            if (part.toLowerCase() === 'custom')
                continue;
            counts.set(part, (counts.get(part) ?? 0) + 1);
        }
    }
    return Array.from(counts.entries())
        .map(([id, count]) => ({ id, label: formatSourceLabel(id), count }))
        .sort((a, b) => a.label.localeCompare(b.label));
}
export async function getSyncStatus() {
    const stamps = [];
    const mongo = await readMongoGlobalDoc();
    if (mongo?.lastUpdated)
        stamps.push(newestIso(mongo.lastUpdated));
    const extVersion = await fetchExtensionVersion();
    if (extVersion)
        stamps.push(extVersion);
    const file = loadGlobalFallback(true);
    if (file?.lastUpdated)
        stamps.push(new Date(file.lastUpdated).toISOString());
    const fileRev = globalFallbackFileRevision();
    if (fileRev)
        stamps.push(fileRev);
    const col = await getCollection('data');
    const mongoConnected = Boolean(col && mongo);
    const hasLocal = isLocalCatalogAvailable() || Boolean(file);
    const hasExtension = Boolean(extVersion);
    return {
        lastUpdated: stamps.length ? newestIso(...stamps) : new Date(0).toISOString(),
        storage: mongoConnected ? 'mongodb' : hasLocal || hasExtension ? 'local' : 'unavailable',
        mongoConnected,
    };
}
export async function searchMonsters(opts) {
    const page = opts.page ?? 1;
    const limit = Math.min(opts.limit ?? 50, 100);
    const merged = await getCachedMonsters();
    let filtered = filterMonsters(merged, opts.q ?? '', opts.crMin, opts.crMax);
    if (opts.isCustom === true) {
        filtered = filtered.filter((m) => isHomebrewEntry(m.isCustom, m.source));
    }
    else if (opts.isCustom === false) {
        filtered = filtered.filter((m) => !isHomebrewEntry(m.isCustom, m.source));
    }
    if (opts.source) {
        filtered = filtered.filter((m) => entryMatchesSource(m.source, opts.source));
    }
    return paginate(filtered, page, limit);
}
export async function getMonsterById(id) {
    const hit = (await getCachedMonsters()).find((m) => m.id === id);
    if (!hit)
        return null;
    const global = await globalDoc({ includeImageData: true });
    const imageUrl = resolveEntryImageUrl(global, 'monster', hit.name, hit.image);
    return imageUrl ? { ...hit, imageUrl } : hit;
}
export async function searchItems(opts) {
    const page = opts.page ?? 1;
    const limit = Math.min(opts.limit ?? 50, 100);
    const merged = await getCachedItems();
    const lower = (opts.q ?? '').trim().toLowerCase();
    let filtered = merged.filter((i) => {
        if (!lower)
            return true;
        return i.name.toLowerCase().includes(lower) || i.description.toLowerCase().includes(lower);
    });
    if (opts.isCustom === true) {
        filtered = filtered.filter((i) => isHomebrewEntry(i.isCustom, i.source));
    }
    else if (opts.isCustom === false) {
        filtered = filtered.filter((i) => !isHomebrewEntry(i.isCustom, i.source));
    }
    if (opts.source) {
        filtered = filtered.filter((i) => entryMatchesSource(i.source, opts.source));
    }
    filtered.sort((a, b) => a.name.localeCompare(b.name));
    return paginate(filtered, page, limit);
}
export async function getItemById(id) {
    const hit = (await getCachedItems()).find((i) => i.id === id);
    if (!hit)
        return null;
    const global = await globalDoc({ includeImageData: true });
    const imageUrl = resolveEntryImageUrl(global, 'item', hit.name, hit.image);
    return imageUrl ? { ...hit, imageUrl } : hit;
}
export async function searchSpells(opts) {
    const page = opts.page ?? 1;
    const limit = Math.min(opts.limit ?? 50, 100);
    const merged = await getCachedSpells();
    const lower = (opts.q ?? '').trim().toLowerCase();
    let filtered = merged.filter((s) => {
        if (!lower)
            return true;
        return s.name.toLowerCase().includes(lower);
    });
    if (opts.isCustom === true) {
        filtered = filtered.filter((s) => isHomebrewEntry(s.isCustom, s.source));
    }
    else if (opts.isCustom === false) {
        filtered = filtered.filter((s) => !isHomebrewEntry(s.isCustom, s.source));
    }
    if (opts.source) {
        filtered = filtered.filter((s) => entryMatchesSource(s.source, opts.source));
    }
    filtered.sort((a, b) => a.name.localeCompare(b.name));
    return paginate(filtered, page, limit);
}
export async function getSpellById(id) {
    const hit = (await getCachedSpells()).find((s) => s.id === id);
    if (!hit)
        return null;
    const global = await globalDoc({ includeImageData: true });
    const imageUrl = resolveEntryImageUrl(global, 'spell', hit.name, undefined);
    return imageUrl ? { ...hit, imageUrl } : hit;
}
async function upsertCollectionMonster(entry, isCustom) {
    const col = await getCollection('monsters');
    if (!col)
        return;
    const _id = slugify(entry.name);
    await col.updateOne({ _id }, { $set: { ...entry, _id, isCustom } }, { upsert: true });
}
async function upsertCollectionItem(entry, isCustom) {
    const col = await getCollection('items');
    if (!col)
        return;
    const _id = slugify(entry.name);
    await col.updateOne({ _id }, { $set: { ...entry, _id, isCustom } }, { upsert: true });
}
async function upsertCollectionSpell(entry, isCustom) {
    const col = await getCollection('spells');
    if (!col)
        return;
    const _id = slugify(entry.name);
    await col.updateOne({ _id }, { $set: { ...entry, _id, isCustom } }, { upsert: true });
}
export async function saveMonster(entry, opts) {
    const saveAs = resolveSaveAs(entry, opts);
    const payload = prepareSavePayload({ ...entry, source: entry.source || 'Custom' }, saveAs);
    if (opts?.previousName && opts.previousName !== payload.name) {
        const col = await getCollection('monsters');
        if (col)
            await col.deleteOne({ _id: slugify(opts.previousName) });
    }
    await saveOwlbearEntry('monster', payload, {
        saveAs,
        previousName: opts?.previousName,
        hidePrevious: opts?.hidePrevious,
    });
    await upsertCollectionMonster(payload, saveAs === 'homebrew');
    const saved = await getMonsterById(slugify(payload.name));
    if (!saved)
        throw new Error('Failed to save monster');
    return saved;
}
export async function saveItem(entry, opts) {
    const saveAs = resolveSaveAs(entry, opts);
    const payload = prepareSavePayload({ ...entry, source: entry.source || 'Custom' }, saveAs);
    if (opts?.previousName && opts.previousName !== payload.name) {
        const col = await getCollection('items');
        if (col)
            await col.deleteOne({ _id: slugify(opts.previousName) });
    }
    await saveOwlbearEntry('item', payload, {
        saveAs,
        previousName: opts?.previousName,
        hidePrevious: opts?.hidePrevious,
    });
    await upsertCollectionItem(payload, saveAs === 'homebrew');
    const saved = await getItemById(slugify(payload.name));
    if (!saved)
        throw new Error('Failed to save item');
    return saved;
}
export async function saveSpell(entry, opts) {
    const saveAs = resolveSaveAs(entry, opts);
    const payload = prepareSavePayload({ ...entry, source: entry.source || 'Custom' }, saveAs);
    if (opts?.previousName && opts.previousName !== payload.name) {
        const col = await getCollection('spells');
        if (col)
            await col.deleteOne({ _id: slugify(opts.previousName) });
    }
    await saveOwlbearEntry('spell', payload, {
        saveAs,
        previousName: opts?.previousName,
        hidePrevious: opts?.hidePrevious,
    });
    await upsertCollectionSpell(payload, saveAs === 'homebrew');
    const saved = await getSpellById(slugify(payload.name));
    if (!saved)
        throw new Error('Failed to save spell');
    return saved;
}
export async function deleteCompendiumEntry(name, kind) {
    const id = slugify(name);
    let inBaseCatalog = false;
    if (kind === 'monster') {
        const col = await getCollection('monsters');
        const base = col ? await col.findOne({ _id: id }) : null;
        inBaseCatalog = Boolean(base && !base.isCustom);
    }
    else if (kind === 'item') {
        const col = await getCollection('items');
        const base = col ? await col.findOne({ _id: id }) : null;
        inBaseCatalog = Boolean(base && !base.isCustom);
    }
    else {
        const col = await getCollection('spells');
        const base = col ? await col.findOne({ _id: id }) : null;
        inBaseCatalog = Boolean(base && !base.isCustom);
    }
    let customOnly = false;
    {
        const global = await globalDoc();
        const inGlobalMonsters = (global.monsters ?? []).some((m) => m.name === name);
        const inGlobalItems = (global.items ?? []).some((i) => i.name === name);
        const inGlobalSpells = (global.spells ?? []).some((s) => s.name.toLowerCase() === name.toLowerCase());
        customOnly = kind === 'monster'
            ? inGlobalMonsters && !inBaseCatalog
            : kind === 'item'
                ? inGlobalItems && !inBaseCatalog
                : inGlobalSpells && !inBaseCatalog;
    }
    await deleteOwlbearEntry(kind, name, { inBaseCatalog });
    if (!customOnly)
        return;
    if (kind === 'monster') {
        const col = await getCollection('monsters');
        if (col)
            await col.deleteOne({ _id: id });
    }
    else if (kind === 'item') {
        const col = await getCollection('items');
        if (col)
            await col.deleteOne({ _id: id });
    }
    else {
        const col = await getCollection('spells');
        if (col)
            await col.deleteOne({ _id: id });
    }
}
export { isLikelyValidItem, slugify };
//# sourceMappingURL=compendiumSync.js.map