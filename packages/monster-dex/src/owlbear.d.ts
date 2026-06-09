import type { OwlbearMonster } from '@grimoire/shared';
export type CompendiumImageKind = 'monster' | 'item' | 'spell';
export declare function compendiumImageKey(kind: CompendiumImageKind, name: string): string;
export declare function compendiumStaticImagePath(key: string): string;
/** Static-image route on the Owlbear extension server (port 3000). */
export declare function owlbearStaticImagePath(key: string): string;
/** Normalize image refs for shared Mongo so the Owlbear extension can resolve them. */
export declare function toOwlbearMongoImageRef(url: string): string;
export declare function slugify(name: string): string;
export declare function parseCr(cr: string | number | undefined): number;
export declare function parseSizeFromType(type: string): string;
export declare function monsterSizeToCells(size: string): number;
export declare function monsterToTokenDefaults(monster: OwlbearMonster & {
    id?: string;
}, gridSize: number): {
    name: string;
    hp: number;
    maxHp: number;
    ac: number;
    sizeCells: number;
    monsterId: string;
    monsterCr: string;
    monsterSource: string;
    imageUrl?: string;
    width: number;
    height: number;
};
/** Skip PDF table-of-contents junk during import. */
export declare function isLikelyValidItem(entry: {
    name: string;
    type?: string;
    description?: string;
}): boolean;
//# sourceMappingURL=owlbear.d.ts.map