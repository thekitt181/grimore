import type { CompendiumItem, CompendiumMonster, CompendiumSpell, CompendiumSyncStatus, CompendiumSaveAs, OwlbearItem, OwlbearMonster, OwlbearSpell } from '@grimoire/shared';
import { isLikelyValidItem, slugify } from '@grimoire/monster-dex';
/** Pre-build merged catalogs on server start so first search is instant. */
export declare function warmCompendiumCatalog(): Promise<void>;
/** Human-readable label for a raw source string (PDF filename, etc.). */
export declare function formatSourceLabel(raw: string): string;
export interface CompendiumSaveOptions {
    previousName?: string;
    hidePrevious?: boolean;
    saveAs?: CompendiumSaveAs;
    replaceEntryId?: string;
}
export declare function listSources(kind: 'monsters' | 'items' | 'spells'): Promise<Array<{
    id: string;
    label: string;
    count: number;
}>>;
export declare function getSyncStatus(): Promise<CompendiumSyncStatus>;
export declare function searchMonsters(opts: {
    q?: string;
    crMin?: number;
    crMax?: number;
    page?: number;
    limit?: number;
    isCustom?: boolean;
    source?: string;
}): Promise<{
    items: CompendiumMonster[];
    total: number;
    page: number;
    limit: number;
}>;
export declare function getMonsterById(id: string): Promise<CompendiumMonster | null>;
export declare function searchItems(opts: {
    q?: string;
    page?: number;
    limit?: number;
    isCustom?: boolean;
    source?: string;
}): Promise<{
    items: CompendiumItem[];
    total: number;
    page: number;
    limit: number;
}>;
export declare function getItemById(id: string): Promise<CompendiumItem | null>;
export declare function searchSpells(opts: {
    q?: string;
    page?: number;
    limit?: number;
    isCustom?: boolean;
    source?: string;
}): Promise<{
    items: CompendiumSpell[];
    total: number;
    page: number;
    limit: number;
}>;
export declare function getSpellById(id: string): Promise<CompendiumSpell | null>;
export declare function saveMonster(entry: OwlbearMonster, opts?: CompendiumSaveOptions): Promise<CompendiumMonster>;
export declare function saveItem(entry: OwlbearItem, opts?: CompendiumSaveOptions): Promise<CompendiumItem>;
export declare function saveSpell(entry: OwlbearSpell, opts?: CompendiumSaveOptions): Promise<CompendiumSpell>;
export declare function deleteCompendiumEntry(name: string, kind: 'monster' | 'item' | 'spell'): Promise<void>;
export { isLikelyValidItem, slugify };
//# sourceMappingURL=compendiumSync.d.ts.map