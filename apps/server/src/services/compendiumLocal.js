import fs from 'fs';
import path from 'path';
import { isLikelyValidItem, slugify } from '@grimoire/monster-dex';
let cachedDir;
let cachedMonsters = null;
let cachedItems = null;
let cachedSpells = null;
function owlbearSrcDir() {
    if (cachedDir !== undefined)
        return cachedDir;
    const candidates = [
        process.env['OWLBear_DATA_DIR'],
        path.resolve(process.cwd(), '../../../owlbear_dnd_extension/src'),
        path.resolve(process.cwd(), '../../owlbear_dnd_extension/src'),
    ].filter(Boolean);
    for (const dir of candidates) {
        if (fs.existsSync(path.join(dir, 'monsters.json'))) {
            cachedDir = dir;
            return dir;
        }
    }
    cachedDir = null;
    return null;
}
export function isLocalCatalogAvailable() {
    return owlbearSrcDir() !== null;
}
function uniqueSlug(name, used) {
    let base = slugify(name);
    if (!used.has(base)) {
        used.add(base);
        return base;
    }
    let n = 2;
    while (used.has(`${base}-${n}`))
        n++;
    const id = `${base}-${n}`;
    used.add(id);
    return id;
}
export function loadLocalMonsters() {
    if (cachedMonsters)
        return cachedMonsters;
    const dir = owlbearSrcDir();
    if (!dir)
        return [];
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'monsters.json'), 'utf8'));
    const used = new Set();
    cachedMonsters = raw.map((m) => ({ ...m, _id: uniqueSlug(m.name, used), isCustom: false }));
    return cachedMonsters;
}
export function loadLocalItems() {
    if (cachedItems)
        return cachedItems;
    const dir = owlbearSrcDir();
    if (!dir)
        return [];
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'items.json'), 'utf8'));
    const used = new Set();
    cachedItems = raw.filter(isLikelyValidItem).map((i) => ({ ...i, _id: uniqueSlug(i.name, used), isCustom: false }));
    return cachedItems;
}
export function loadLocalSpells() {
    if (cachedSpells)
        return cachedSpells;
    const dir = owlbearSrcDir();
    if (!dir)
        return [];
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'spells.json'), 'utf8'));
    const used = new Set();
    cachedSpells = Object.entries(raw).map(([name, spell]) => ({
        ...spell,
        name,
        _id: uniqueSlug(name, used),
        isCustom: false,
    }));
    return cachedSpells;
}
export function getLocalMonsterById(id) {
    return loadLocalMonsters().find((m) => m._id === id) ?? null;
}
export function getLocalItemById(id) {
    return loadLocalItems().find((i) => i._id === id) ?? null;
}
export function getLocalSpellById(id) {
    return loadLocalSpells().find((s) => s._id === id) ?? null;
}
//# sourceMappingURL=compendiumLocal.js.map