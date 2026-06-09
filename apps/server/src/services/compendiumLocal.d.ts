import type { OwlbearItem, OwlbearMonster, OwlbearSpell } from '@grimoire/shared';
type StoredMonster = OwlbearMonster & {
    _id: string;
    isCustom?: boolean;
};
type StoredItem = OwlbearItem & {
    _id: string;
    isCustom?: boolean;
};
type StoredSpell = OwlbearSpell & {
    _id: string;
    isCustom?: boolean;
};
export declare function isLocalCatalogAvailable(): boolean;
export declare function loadLocalMonsters(): StoredMonster[];
export declare function loadLocalItems(): StoredItem[];
export declare function loadLocalSpells(): StoredSpell[];
export declare function getLocalMonsterById(id: string): StoredMonster | null;
export declare function getLocalItemById(id: string): StoredItem | null;
export declare function getLocalSpellById(id: string): StoredSpell | null;
export {};
//# sourceMappingURL=compendiumLocal.d.ts.map