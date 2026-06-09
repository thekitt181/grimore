import fs from 'fs';
import path from 'path';
import { normalizeOwlbearGlobalDoc } from '@grimoire/shared';
let cached;
let cachedMtime = 0;
function globalJsonPath() {
    const candidates = [
        process.env['OWLBear_GLOBAL_PATH'],
        process.env['OWLBear_DATA_DIR']
            ? path.join(path.dirname(process.env['OWLBear_DATA_DIR']), 'server', 'data.json')
            : null,
        path.resolve(process.cwd(), '../../../owlbear_dnd_extension/server/data.json'),
        path.resolve(process.cwd(), '../../owlbear_dnd_extension/server/data.json'),
    ].filter(Boolean);
    for (const p of candidates) {
        if (fs.existsSync(p))
            return p;
    }
    return null;
}
function fileMtimeMs(filePath) {
    try {
        return fs.statSync(filePath).mtimeMs;
    }
    catch {
        return 0;
    }
}
/** ISO timestamp from file mtime — detects extension writes to data.json when Mongo is down. */
export function globalFallbackFileRevision() {
    const filePath = globalJsonPath();
    if (!filePath)
        return null;
    const mtime = fileMtimeMs(filePath);
    if (!mtime)
        return null;
    return new Date(mtime).toISOString();
}
/** Load raw Owlbear data.json (override* + custom arrays intact). */
export function loadRawGlobalFallback() {
    const filePath = globalJsonPath();
    if (!filePath)
        return null;
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
    catch {
        return null;
    }
}
/** Load custom monsters/items/spells/images from Owlbear local Mongo fallback file. */
export function loadGlobalFallback(force = false) {
    const filePath = globalJsonPath();
    if (!filePath) {
        cached = null;
        cachedMtime = 0;
        return null;
    }
    const mtime = fileMtimeMs(filePath);
    if (!force && cached !== undefined && mtime === cachedMtime) {
        return cached;
    }
    try {
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        cached = normalizeOwlbearGlobalDoc(raw);
        cachedMtime = mtime;
        return cached;
    }
    catch (err) {
        console.error('[Compendium] Failed to read global fallback:', err);
        cached = null;
        cachedMtime = mtime;
        return null;
    }
}
export function clearGlobalFallbackCache() {
    cached = undefined;
    cachedMtime = 0;
}
/** Persist global overrides to Owlbear data.json when MongoDB is unavailable (or as mirror). */
export function saveGlobalFallback(next, rawMongo) {
    const filePath = globalJsonPath();
    if (!filePath)
        return null;
    try {
        let raw = {};
        try {
            raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
        catch {
            // start fresh if unreadable
        }
        const toWrite = {
            ...raw,
            deleted: rawMongo?.deleted ?? next.deleted ?? [],
            images: next.images ?? {},
            imagesData: next.imagesData ?? {},
            entryImages: next.entryImages ?? {},
            lastUpdated: next.lastUpdated,
        };
        if (rawMongo) {
            for (const key of [
                'monsters',
                'items',
                'spells',
                'overrideMonsters',
                'overrideItems',
                'overrideSpells',
            ]) {
                if (Array.isArray(rawMongo[key]))
                    toWrite[key] = rawMongo[key];
            }
        }
        else {
            toWrite.monsters = next.monsters ?? [];
            toWrite.items = next.items ?? [];
            toWrite.spells = next.spells ?? [];
        }
        fs.writeFileSync(filePath, JSON.stringify(toWrite, null, 2), 'utf8');
        cached = next;
        cachedMtime = fileMtimeMs(filePath);
        console.log('[Compendium] Saved global fallback to', filePath);
        return next;
    }
    catch (err) {
        console.error('[Compendium] Failed to write global fallback:', err);
        return null;
    }
}
//# sourceMappingURL=compendiumGlobalFallback.js.map