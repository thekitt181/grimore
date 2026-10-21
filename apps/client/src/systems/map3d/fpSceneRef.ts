import type * as THREE from 'three';

/** Live R3F scene — set by FpPaintSampler for FP spray/breach raycasts. */
export const fpSceneRef: { current: THREE.Scene | null } = { current: null };
