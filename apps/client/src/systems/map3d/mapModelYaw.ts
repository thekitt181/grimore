import { TABLE_MINI_VIEW_AZIMUTH_OFFSET } from './orthographicCameraSync';

/**
 * Fixed Y rotation for GLB maps in both 2D and 3D (grid stays axis-aligned).
 * Must not change with viewMode — toggling yaw on 2D→3D made the mesh slide off the grid.
 */
export const MAP_MODEL_YAW = Math.PI + TABLE_MINI_VIEW_AZIMUTH_OFFSET;
