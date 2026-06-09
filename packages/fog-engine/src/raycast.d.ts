/**
 * 2D ray-casting visibility polygon for fog of war / line of sight.
 *
 * Casts rays toward every wall endpoint (with tiny angular offsets for corners),
 * finds the nearest wall hit or radius limit per ray, and returns the sorted
 * polygon for rendering on the PixiJS fog layer.
 */
export interface Point {
    x: number;
    y: number;
}
export interface WallSegment {
    a: Point;
    b: Point;
}
export interface VisibilityResult {
    polygon: Point[];
}
/** Axis-aligned square vision footprint (map-local pixels). */
export interface VisionBounds {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}
/** Ray–segment intersection; returns ray parameter t (distance along unit dir) or null. */
export declare function rayHitSegment(origin: Point, dirX: number, dirY: number, seg: WallSegment): number | null;
/** Build a visibility polygon from an origin, wall segments, and max vision radius. */
export declare function castRays(origin: Point, walls: WallSegment[], radius?: number): VisibilityResult;
/** Alias used by rendering hooks. */
export declare function computeVisibilityPolygon(origin: Point, walls: WallSegment[], radius?: number): Point[];
/** Ray-cast LOS limited to a directional arc (vision cone). */
export declare function computeVisibilityPolygonDirectional(origin: Point, walls: WallSegment[], radius: number, facingRad: number, arcRad: number): Point[];
/** Ray-cast LOS clipped to a square footprint — smooth wall edges, square max range. */
export declare function computeVisibilityPolygonInSquare(origin: Point, walls: WallSegment[], bounds: VisionBounds): Point[];
//# sourceMappingURL=raycast.d.ts.map