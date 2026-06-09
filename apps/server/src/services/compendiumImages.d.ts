import type { CompendiumGlobalDoc, CompendiumImageKind } from '@grimoire/shared';
export declare function resolveEntryImageUrl(global: CompendiumGlobalDoc, kind: CompendiumImageKind, name: string, entryImage?: string): string | undefined;
export declare function resolveHistoryUrl(global: CompendiumGlobalDoc, url: string): string;
export declare function getGlobalDocForImages(): Promise<CompendiumGlobalDoc>;
export declare function getEntryImageState(kind: CompendiumImageKind, name: string, entryImage?: string): Promise<{
    key: string;
    current: string | null;
    history: string[];
    updatedAt?: string;
}>;
export declare function saveEntryImage(kind: CompendiumImageKind, name: string, imageUrl: string | null, entryImage?: string): Promise<{
    key: string;
    current: string | null;
    history: string[];
    updatedAt?: string;
}>;
export declare function serveStaticImage(key: string, res: import('express').Response): Promise<void>;
export declare function serveAssetFile(relativePath: string, res: import('express').Response): void;
//# sourceMappingURL=compendiumImages.d.ts.map