import type { CompendiumGlobalDoc } from '@grimoire/shared';
export declare function fetchExtensionVersion(): Promise<string | null>;
/** Pull the Owlbear extension global doc (reads Mongo on the extension server). */
export declare function fetchExtensionGlobalDoc(force?: boolean): Promise<CompendiumGlobalDoc | null>;
export declare function invalidateExtensionGlobalCache(): void;
//# sourceMappingURL=compendiumExtensionBridge.d.ts.map