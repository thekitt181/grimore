import type { OwlbearItem, OwlbearMonster, OwlbearRawGlobalDoc, OwlbearSpell } from '@grimoire/shared';
export type OwlbearEntry = (OwlbearMonster | OwlbearItem | OwlbearSpell) & {
    originBookName?: string;
};
export declare function normalizeEntryName(name: string): string;
export declare function namesMatch(a: string, b: string): boolean;
export declare function entryNameKey(name: string): string;
export declare function dedupeByEntryName<T extends {
    name: string;
}>(entries: T[] | undefined): T[];
export declare function isHiddenBuiltIn(builtInName: string, overrides: OwlbearEntry[], deleted: string[]): boolean;
/** Strip custom entries that duplicate overrides, deleted originals, or built-in catalog names. */
export declare function filterCustomEntries<T extends OwlbearEntry>(kind: 'monster' | 'item' | 'spell', customs: T[] | undefined, overrides: T[], deleted: string[]): T[];
/** Mirror Owlbear extension server normalizeLibraryData — dedupe overrides and filter customs. */
export declare function normalizeOwlbearRawDoc(raw: OwlbearRawGlobalDoc): OwlbearRawGlobalDoc;
//# sourceMappingURL=compendiumMerge.d.ts.map