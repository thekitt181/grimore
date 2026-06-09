import { loadLocalItems, loadLocalMonsters, loadLocalSpells, } from './compendiumLocal';
export function normalizeEntryName(name) {
    return String(name || '').trim();
}
export function namesMatch(a, b) {
    if (!a || !b)
        return false;
    return normalizeEntryName(a).toLowerCase() === normalizeEntryName(b).toLowerCase();
}
export function entryNameKey(name) {
    return normalizeEntryName(name).toLowerCase();
}
export function dedupeByEntryName(entries) {
    const map = new Map();
    for (const entry of entries ?? []) {
        if (!entry?.name)
            continue;
        map.set(entryNameKey(entry.name), entry);
    }
    return Array.from(map.values());
}
export function isHiddenBuiltIn(builtInName, overrides, deleted) {
    return overrides.some((o) => namesMatch(o.name, builtInName)
        || (o.originBookName && namesMatch(o.originBookName, builtInName))) || deleted.some((d) => namesMatch(d, builtInName));
}
function isBuiltInName(kind, name) {
    const key = entryNameKey(name);
    if (kind === 'monster') {
        return loadLocalMonsters().some((m) => entryNameKey(m.name) === key);
    }
    if (kind === 'item') {
        return loadLocalItems().some((i) => entryNameKey(i.name) === key);
    }
    return loadLocalSpells().some((s) => entryNameKey(s.name) === key);
}
/** Strip custom entries that duplicate overrides, deleted originals, or built-in catalog names. */
export function filterCustomEntries(kind, customs, overrides, deleted) {
    const overrideNames = new Set(overrides.map((o) => entryNameKey(o.name)));
    const originNames = new Set(overrides
        .filter((o) => o.originBookName)
        .map((o) => entryNameKey(o.originBookName)));
    const deletedNames = new Set(deleted.map((d) => entryNameKey(d)));
    return dedupeByEntryName(customs).filter((entry) => {
        const name = entryNameKey(entry.name);
        if (overrideNames.has(name))
            return false;
        if (originNames.has(name))
            return false;
        if (deletedNames.has(name))
            return false;
        if (entry.originBookName)
            return false;
        if (isBuiltInName(kind, entry.name))
            return false;
        return true;
    });
}
/** Mirror Owlbear extension server normalizeLibraryData — dedupe overrides and filter customs. */
export function normalizeOwlbearRawDoc(raw) {
    const overrideMonsters = dedupeByEntryName(raw.overrideMonsters);
    const overrideItems = dedupeByEntryName(raw.overrideItems);
    const overrideSpells = dedupeByEntryName(raw.overrideSpells);
    let deleted = [...(raw.deleted ?? [])];
    const ensureDeleted = (name) => {
        if (!name)
            return;
        if (!deleted.some((d) => namesMatch(d, name))) {
            deleted.push(normalizeEntryName(name));
        }
    };
    for (const override of [...overrideMonsters, ...overrideItems, ...overrideSpells]) {
        if (override.originBookName && !namesMatch(override.originBookName, override.name)) {
            ensureDeleted(override.originBookName);
        }
    }
    return {
        ...raw,
        overrideMonsters,
        overrideItems,
        overrideSpells,
        monsters: filterCustomEntries('monster', raw.monsters, overrideMonsters, deleted),
        items: filterCustomEntries('item', raw.items, overrideItems, deleted),
        spells: filterCustomEntries('spell', raw.spells, overrideSpells, deleted),
        deleted,
    };
}
//# sourceMappingURL=compendiumMerge.js.map