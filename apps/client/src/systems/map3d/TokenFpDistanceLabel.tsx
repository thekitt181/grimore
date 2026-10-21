import { useRef } from 'react';
import { Html } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { getMapGridSize } from '@/systems/combat/attackRange';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { useLiveTransformStore } from '@/systems/scene/store/liveTransformStore';
import { useFirstPersonStore } from './firstPersonStore';
import { resolveItemBounds } from './sceneItemBounds';
import type { Item } from '@/systems/scene/types';

const REF_FOOTPRINT = 70;
const FEET_PER_CELL = 5;

function labelFontPx(footprint: number): number {
  return Math.max(10, Math.min(20, footprint * 0.14));
}

/** Edge-to-edge feet between two resolved footprints (includes FP pose / live drag). */
function boundsDistanceFeet(
  a: { cx: number; cz: number; width: number; height: number },
  b: { cx: number; cz: number; width: number; height: number },
  gridSize: number,
): number {
  const distPx = Math.hypot(b.cx - a.cx, b.cz - a.cz);
  const centerFeet = (distPx / gridSize) * FEET_PER_CELL;
  const aR = (Math.min(a.width, a.height) / 2 / gridSize) * FEET_PER_CELL;
  const bR = (Math.min(b.width, b.height) / 2 / gridSize) * FEET_PER_CELL;
  return Math.max(0, Math.round(centerFeet - aR - bR));
}

/**
 * First-person only: floating "N ft" on other tokens, live from your pose.
 * Anchored just under the name tag.
 */
export function TokenFpDistanceLabel({
  tokenId,
  footprint,
  localY,
}: {
  tokenId: string;
  footprint: number;
  localY?: number;
}) {
  const fpEnabled = useFirstPersonStore((s) => s.enabled);
  const viewerId = useFirstPersonStore((s) => s.tokenId);
  const anchorRef = useRef<THREE.Group>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const lastFeet = useRef<number | null>(null);
  const { camera, size } = useThree();
  const fontPx = labelFontPx(footprint);
  // Sit under TokenNameLabel (name uses ~0.54 × footprint, grow upward).
  const anchorY = localY ?? footprint * 0.54;

  useFrame(() => {
    const el = labelRef.current;
    const text = textRef.current;
    const anchor = anchorRef.current;
    if (!el || !text || !anchor) return;

    if (!fpEnabled || !viewerId || viewerId === tokenId) {
      el.style.visibility = 'hidden';
      return;
    }

    const items = useItemStore.getState().items;
    const viewer = items[viewerId];
    const target = items[tokenId];
    if (!viewer || viewer.type !== 'token' || !target || target.type !== 'token') {
      el.style.visibility = 'hidden';
      return;
    }

    const liveById = useLiveTransformStore.getState().byId;
    const a = resolveItemBounds(viewer as Item, liveById[viewerId]);
    const b = resolveItemBounds(target as Item, liveById[tokenId]);
    const feet = boundsDistanceFeet(a, b, getMapGridSize());

    if (lastFeet.current !== feet) {
      lastFeet.current = feet;
      text.textContent = `${feet} ft`;
    }
    el.style.visibility = 'visible';

    const world = new THREE.Vector3();
    anchor.getWorldPosition(world);
    const dist = camera.position.distanceTo(world);

    let pxScale: number;
    if ((camera as THREE.OrthographicCamera).isOrthographicCamera) {
      const ortho = camera as THREE.OrthographicCamera;
      const viewH = (ortho.top - ortho.bottom) / Math.max(ortho.zoom, 1e-6);
      pxScale = (fontPx / size.height) * viewH / Math.max(dist, 1);
    } else {
      const persp = camera as THREE.PerspectiveCamera;
      const vFov = (persp.fov * Math.PI) / 180;
      pxScale = (fontPx * 2 * dist * Math.tan(vFov / 2)) / size.height;
    }

    const sizeFactor = THREE.MathUtils.clamp(footprint / REF_FOOTPRINT, 0.55, 2.6);
    const scale = THREE.MathUtils.clamp(pxScale * sizeFactor, 0.35, 2.4);
    // Below the name badge (name grows upward from the same anchor).
    el.style.transform = `translate(-50%, 4px) scale(${scale})`;
  });

  if (!fpEnabled || viewerId === tokenId) return null;

  return (
    <group ref={anchorRef} position={[0, anchorY, 0]}>
      <Html
        center
        distanceFactor={1_000_000}
        zIndexRange={[39, 0]}
        style={{ pointerEvents: 'none', userSelect: 'none' }}
      >
        <div
          ref={labelRef}
          className="font-ui whitespace-nowrap tabular-nums"
          style={{
            fontSize: `${fontPx}px`,
            lineHeight: 1.15,
            padding: '1px 6px',
            borderRadius: 4,
            background: 'rgba(10,10,15,0.82)',
            color: '#c9a84c',
            border: '1px solid rgba(201,168,76,0.35)',
            transformOrigin: '50% 0%',
            fontWeight: 700,
            textShadow: '0 1px 2px rgba(0,0,0,0.85)',
            visibility: 'hidden',
          }}
        >
          <span ref={textRef}>0 ft</span>
        </div>
      </Html>
    </group>
  );
}
