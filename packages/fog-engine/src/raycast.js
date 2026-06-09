/**
 * 2D ray-casting visibility polygon for fog of war / line of sight.
 *
 * Casts rays toward every wall endpoint (with tiny angular offsets for corners),
 * finds the nearest wall hit or radius limit per ray, and returns the sorted
 * polygon for rendering on the PixiJS fog layer.
 */
const EPS_ANGLE = 0.00001;
const DEDUP_DIST_SQ = 0.25;
function distSq(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return dx * dx + dy * dy;
}
function angleTo(origin, p) {
    return Math.atan2(p.y - origin.y, p.x - origin.x);
}
/** Ray–segment intersection; returns ray parameter t (distance along unit dir) or null. */
export function rayHitSegment(origin, dirX, dirY, seg) {
    const sx = seg.b.x - seg.a.x;
    const sy = seg.b.y - seg.a.y;
    const denom = dirX * sy - dirY * sx;
    if (Math.abs(denom) < 1e-10)
        return null;
    const ox = seg.a.x - origin.x;
    const oy = seg.a.y - origin.y;
    const t = (ox * sy - oy * sx) / denom;
    const u = (ox * dirY - oy * dirX) / denom;
    if (t >= 0 && u >= 0 && u <= 1)
        return t;
    return null;
}
function collectAngles(origin, walls, bounds) {
    const angles = [];
    const push = (a) => {
        angles.push(a, a - EPS_ANGLE, a + EPS_ANGLE);
    };
    for (const w of walls) {
        push(angleTo(origin, w.a));
        push(angleTo(origin, w.b));
    }
    if (bounds) {
        const corners = [
            { x: bounds.minX, y: bounds.minY },
            { x: bounds.maxX, y: bounds.minY },
            { x: bounds.maxX, y: bounds.maxY },
            { x: bounds.minX, y: bounds.maxY },
        ];
        for (const c of corners)
            push(angleTo(origin, c));
    }
    if (walls.length === 0 && !bounds) {
        const steps = 72;
        for (let i = 0; i < steps; i++) {
            angles.push((2 * Math.PI * i) / steps);
        }
    }
    return angles;
}
/** Distance along a unit ray until it exits an axis-aligned box. */
function rayAabbLimit(ox, oy, dirX, dirY, bounds) {
    let t = Infinity;
    if (dirX > 1e-10)
        t = Math.min(t, (bounds.maxX - ox) / dirX);
    else if (dirX < -1e-10)
        t = Math.min(t, (bounds.minX - ox) / dirX);
    if (dirY > 1e-10)
        t = Math.min(t, (bounds.maxY - oy) / dirY);
    else if (dirY < -1e-10)
        t = Math.min(t, (bounds.minY - oy) / dirY);
    return Number.isFinite(t) && t > 0 ? t : 0;
}
function castSingleRay(origin, angle, walls, radius) {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    let minT = radius;
    for (const w of walls) {
        const t = rayHitSegment(origin, dx, dy, w);
        if (t !== null && t < minT)
            minT = t;
    }
    return {
        angle,
        point: { x: origin.x + dx * minT, y: origin.y + dy * minT },
    };
}
function dedupePolygon(points) {
    const out = [];
    for (const p of points) {
        const last = out[out.length - 1];
        if (!last || distSq(last, p) > DEDUP_DIST_SQ)
            out.push(p);
    }
    if (out.length > 2 && distSq(out[0], out[out.length - 1]) <= DEDUP_DIST_SQ) {
        out.pop();
    }
    return out;
}
/** Build a visibility polygon from an origin, wall segments, and max vision radius. */
export function castRays(origin, walls, radius = 1000) {
    const angles = collectAngles(origin, walls);
    const hits = angles.map((a) => castSingleRay(origin, a, walls, radius));
    hits.sort((a, b) => a.angle - b.angle);
    const polygon = dedupePolygon(hits.map((h) => h.point));
    return { polygon };
}
/** Alias used by rendering hooks. */
export function computeVisibilityPolygon(origin, walls, radius = 1000) {
    return castRays(origin, walls, radius).polygon;
}
function castSingleRayInSquare(origin, angle, walls, bounds) {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    let minT = rayAabbLimit(origin.x, origin.y, dx, dy, bounds);
    for (const w of walls) {
        const t = rayHitSegment(origin, dx, dy, w);
        if (t !== null && t < minT)
            minT = t;
    }
    return {
        angle,
        point: { x: origin.x + dx * minT, y: origin.y + dy * minT },
    };
}
function normalizeAngle(a) {
    let n = a % (2 * Math.PI);
    if (n <= -Math.PI)
        n += 2 * Math.PI;
    if (n > Math.PI)
        n -= 2 * Math.PI;
    return n;
}
function angleInArc(angle, facing, halfArc) {
    return Math.abs(normalizeAngle(angle - facing)) <= halfArc + 1e-9;
}
/** Ray-cast LOS limited to a directional arc (vision cone). */
export function computeVisibilityPolygonDirectional(origin, walls, radius, facingRad, arcRad) {
    const halfArc = arcRad / 2;
    const minA = facingRad - halfArc;
    const maxA = facingRad + halfArc;
    const angles = [];
    const push = (a) => {
        if (angleInArc(a, facingRad, halfArc)) {
            angles.push(a, a - EPS_ANGLE, a + EPS_ANGLE);
        }
    };
    angles.push(minA, maxA);
    for (const w of walls) {
        push(angleTo(origin, w.a));
        push(angleTo(origin, w.b));
    }
    const steps = Math.max(64, Math.ceil(arcRad / (Math.PI / 180)));
    for (let i = 0; i <= steps; i++) {
        angles.push(minA + (arcRad * i) / steps);
    }
    const hits = angles.map((a) => castSingleRay(origin, a, walls, radius));
    hits.sort((a, b) => a.angle - b.angle);
    const outer = dedupePolygon(hits.map((h) => h.point));
    if (outer.length === 0) {
        return [
            origin,
            { x: origin.x + Math.cos(minA) * radius, y: origin.y + Math.sin(minA) * radius },
            { x: origin.x + Math.cos(maxA) * radius, y: origin.y + Math.sin(maxA) * radius },
        ];
    }
    return [origin, ...outer];
}
/** Ray-cast LOS clipped to a square footprint — smooth wall edges, square max range. */
export function computeVisibilityPolygonInSquare(origin, walls, bounds) {
    const angles = collectAngles(origin, walls, bounds);
    const hits = angles.map((a) => castSingleRayInSquare(origin, a, walls, bounds));
    hits.sort((a, b) => a.angle - b.angle);
    return dedupePolygon(hits.map((h) => h.point));
}
//# sourceMappingURL=raycast.js.map