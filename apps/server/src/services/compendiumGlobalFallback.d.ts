import type { CompendiumGlobalDoc, OwlbearRawGlobalDoc } from '@grimoire/shared';
/** ISO timestamp from file mtime — detects extension writes to data.json when Mongo is down. */
export declare function globalFallbackFileRevision(): string | null;
/** Load raw Owlbear data.json (override* + custom arrays intact). */
export declare function loadRawGlobalFallback(): OwlbearRawGlobalDoc | null;
/** Load custom monsters/items/spells/images from Owlbear local Mongo fallback file. */
export declare function loadGlobalFallback(force?: boolean): CompendiumGlobalDoc | null;
export declare function clearGlobalFallbackCache(): void;
/** Persist global overrides to Owlbear data.json when MongoDB is unavailable (or as mirror). */
export declare function saveGlobalFallback(next: CompendiumGlobalDoc, rawMongo?: OwlbearRawGlobalDoc | Record<string, unknown>): CompendiumGlobalDoc | null;
//# sourceMappingURL=compendiumGlobalFallback.d.ts.map