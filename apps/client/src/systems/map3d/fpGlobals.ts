/**
 * True process singletons for FP state — Vite HMR can duplicate ES module
 * bindings across FirstPersonCamera / controls / fpPoseSync, which made the
 * network publisher see empty keys while the camera still walked locally.
 *
 * ALWAYS read/write through `fpGlobal` / helpers that hit globalThis — never
 * capture Map references in other modules.
 */
export type FpPoseState = {
  active: boolean;
  tokenId: string | null;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
};

export type FpMotionState = {
  velX: number;
  velY: number;
  held: Set<string>;
  eyeY: number;
  groundY: number;
  accum: number;
};

export type FpLookState = {
  yaw: number;
  pitch: number;
};

export type WalkPose = { x: number; y: number; rotation?: number; at: number };

/** Stamped onto Three.Group / Pixi container — survives Map-split HMR bugs. */
export type FpWalkStamp = { x: number; y: number; rotation: number; at: number };

/** Minimal Three group handle for socket-time writes. */
export type RemoteThreeGroup = {
  position: { x: number; y: number; z: number; set: (x: number, y: number, z: number) => void };
  rotation: { set: (x: number, y: number, z: number) => void };
  userData: Record<string, unknown>;
};

type FpGlobal = {
  pose: FpPoseState;
  motion: FpMotionState;
  look: FpLookState;
  walkPoses: Map<string, WalkPose>;
  threeGroups: Map<string, RemoteThreeGroup>;
  /** Live R3F scene — resolve tokens by name instead of stale Map refs. */
  threeScene: import('three').Scene | null;
  /** Pixi token containers — registered by useItemRenderer. */
  pixiById: Map<string, { position: { set: (x: number, y: number) => void }; rotation: number; __fpWalk?: FpWalkStamp }>;
  /** Mid-walk network stream active — yaw must not use updateItem. */
  walkStreaming: boolean;
  /** Set when WASD is blocked (e.g. initiative budget). */
  moveBlockedReason: 'initiative' | null;
};

const root = globalThis as typeof globalThis & { __grimoireFp?: FpGlobal };

function ensure(): FpGlobal {
  if (!root.__grimoireFp) {
    root.__grimoireFp = {
      pose: {
        active: false,
        tokenId: null,
        x: 0,
        y: 0,
        prevX: 0,
        prevY: 0,
      },
      motion: {
        velX: 0,
        velY: 0,
        held: new Set(),
        eyeY: NaN,
        groundY: 0,
        accum: 0,
      },
      look: { yaw: 0, pitch: 0 },
      walkPoses: new Map(),
      threeGroups: new Map(),
      threeScene: null,
      pixiById: new Map(),
      walkStreaming: false,
      moveBlockedReason: null,
    };
  }
  const g = root.__grimoireFp;
  if (!g.threeGroups) g.threeGroups = new Map();
  if (!g.pixiById) g.pixiById = new Map();
  if (!g.walkPoses) g.walkPoses = new Map();
  if (g.threeScene === undefined) g.threeScene = null;
  if (g.walkStreaming == null) g.walkStreaming = false;
  return g;
}

// Property access always hits the current globalThis singleton (HMR-safe).
export const fpGlobal = new Proxy({} as FpGlobal, {
  get(_t, prop, _r) {
    return Reflect.get(ensure(), prop, ensure());
  },
  set(_t, prop, value) {
    return Reflect.set(ensure(), prop, value);
  },
  has(_t, prop) {
    return Reflect.has(ensure(), prop);
  },
  ownKeys() {
    return Reflect.ownKeys(ensure());
  },
  getOwnPropertyDescriptor(_t, prop) {
    return Reflect.getOwnPropertyDescriptor(ensure(), prop);
  },
}) as FpGlobal;
