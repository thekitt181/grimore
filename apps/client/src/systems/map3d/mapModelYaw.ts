/**
 * Fixed Y rotation for GLB maps in both 2D and 3D.
 * Cardinal only — do not add the token-mini azimuth offset or kits sit off the grid
 * while the selection box stays axis-aligned.
 */
export const MAP_MODEL_YAW = Math.PI;
