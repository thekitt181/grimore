import type { CompendiumGlobalDoc } from '@grimoire/shared';
/** Merge two global docs; the doc with the newer lastUpdated wins on conflicts. */
export declare function mergeGlobalDocs(a: CompendiumGlobalDoc, b: CompendiumGlobalDoc): CompendiumGlobalDoc;
export declare function newestIso(...values: Array<string | Date | undefined>): string;
export declare function isoTimestamp(value: string | Date | undefined): string;
export type GlobalDocReadOptions = {
    /** Skip heavy base64 blobs — fine for search/list; keep false when saving or serving images. */
    includeImageData?: boolean;
};
export declare function readMongoGlobalDoc(opts?: GlobalDocReadOptions): Promise<CompendiumGlobalDoc | null>;
/** Merged view: Mongo + Owlbear extension + local data.json (newest source wins per field). */
export declare function globalDoc(opts?: GlobalDocReadOptions): Promise<CompendiumGlobalDoc>;
/**
 * Atomic read-modify-write on the global compendium doc (queued).
 * Reads Mongo directly — never stale extension HTTP cache.
 */
export declare function mutateGlobal(apply: (current: CompendiumGlobalDoc) => Partial<CompendiumGlobalDoc>): Promise<CompendiumGlobalDoc>;
/** Persist compendium overrides to MongoDB (primary) and data.json (mirror). */
export declare function saveGlobal(partial: Partial<CompendiumGlobalDoc>): Promise<CompendiumGlobalDoc>;
/** On startup, mirror MongoDB into local data.json (Mongo is source of truth). */
export declare function syncCompendiumStorageOnStartup(): Promise<void>;
//# sourceMappingURL=compendiumGlobal.d.ts.map