import type { CompendiumGlobalDoc, CompendiumSaveAs, OwlbearItem, OwlbearMonster, OwlbearRawGlobalDoc, OwlbearSpell } from '@grimoire/shared';
export type CompendiumKind = 'monster' | 'item' | 'spell';
/** Dedupe overrides and strip stale custom copies in Mongo/data.json. */
export declare function reconcileRawGlobalStorage(): Promise<void>;
/** Read the raw Owlbear Mongo/fallback doc (override* arrays intact). */
export declare function readRawGlobalDoc(): Promise<OwlbearRawGlobalDoc>;
export declare function persistRawGlobalDoc(raw: OwlbearRawGlobalDoc): Promise<CompendiumGlobalDoc>;
export interface OwlbearSaveOptions {
    saveAs: CompendiumSaveAs;
    previousName?: string;
    hidePrevious?: boolean;
}
/** Save a compendium entry in Owlbear-native Mongo format (override* vs custom arrays). */
export declare function saveOwlbearEntry(kind: CompendiumKind, entry: OwlbearMonster | OwlbearItem | OwlbearSpell, opts: OwlbearSaveOptions): Promise<CompendiumGlobalDoc>;
export interface OwlbearDeleteOptions {
    inBaseCatalog: boolean;
}
/** Delete/hide a compendium entry using Owlbear-native storage. */
export declare function deleteOwlbearEntry(kind: CompendiumKind, name: string, opts: OwlbearDeleteOptions): Promise<CompendiumGlobalDoc>;
/** Patch image fields on the raw doc without flattening override/custom structure. */
export declare function saveOwlbearImageFields(patch: Pick<CompendiumGlobalDoc, 'images' | 'imagesData' | 'entryImages'>, entryPatch?: {
    kind: CompendiumKind;
    name: string;
    image?: string;
}): Promise<CompendiumGlobalDoc>;
//# sourceMappingURL=compendiumOwlbearPersist.d.ts.map