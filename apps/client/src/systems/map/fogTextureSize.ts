/** Cap fog GPU uploads — full map pixel size is unnecessary for a soft overlay. */
const MAX_FOG_TEXTURE_DIM = 1024;

export function fogTextureDimensions(
  mapWidth: number,
  mapHeight: number,
): { width: number; height: number; scale: number } {
  const mw = Math.max(1, mapWidth);
  const mh = Math.max(1, mapHeight);
  const scale = Math.min(1, MAX_FOG_TEXTURE_DIM / Math.max(mw, mh));
  return {
    width: Math.max(1, Math.round(mw * scale)),
    height: Math.max(1, Math.round(mh * scale)),
    scale,
  };
}
