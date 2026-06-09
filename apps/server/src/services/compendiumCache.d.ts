import type { CompendiumGlobalDoc } from '@grimoire/shared';
export declare function registerCompendiumCacheInvalidator(fn: () => void): void;
export declare function invalidateCompendiumCaches(): void;
export declare function getCachedGlobalLite(): CompendiumGlobalDoc | null;
export declare function setCachedGlobalLite(doc: CompendiumGlobalDoc): void;
//# sourceMappingURL=compendiumCache.d.ts.map