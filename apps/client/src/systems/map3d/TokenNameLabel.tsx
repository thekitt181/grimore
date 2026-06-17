import { useRef } from 'react';
import { Html } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

const REF_FOOTPRINT = 70;

function labelFontPx(footprint: number): number {
  return Math.max(10, Math.min(24, footprint * 0.17));
}

/** Name tag above token — scales with token footprint and stays readable. */
export function TokenNameLabel({
  name,
  footprint,
  localY,
}: {
  name: string;
  footprint: number;
  /** Y above token center; default sits just above the top edge. */
  localY?: number;
}) {
  const anchorRef = useRef<THREE.Group>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const { camera, size } = useThree();
  const fontPx = labelFontPx(footprint);
  const anchorY = localY ?? footprint * 0.54;

  useFrame(() => {
    const anchor = anchorRef.current;
    const el = labelRef.current;
    if (!anchor || !el) return;

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
    const scale = THREE.MathUtils.clamp(pxScale * sizeFactor, 0.4, 2.8);
    el.style.transform = `translate(-50%, -100%) scale(${scale})`;
  });

  return (
    <group ref={anchorRef} position={[0, anchorY, 0]}>
      <Html
        center
        distanceFactor={1_000_000}
        zIndexRange={[40, 0]}
        style={{ pointerEvents: 'none', userSelect: 'none' }}
      >
        <div
          ref={labelRef}
          className="font-ui whitespace-nowrap"
          style={{
            fontSize: `${fontPx}px`,
            lineHeight: 1.2,
            padding: '2px 7px',
            borderRadius: 4,
            background: 'rgba(10,10,15,0.9)',
            color: '#e8e0d0',
            border: '1px solid rgba(201,168,76,0.4)',
            transformOrigin: '50% 100%',
            fontWeight: 600,
            textShadow: '0 1px 2px rgba(0,0,0,0.85)',
          }}
        >
          {name}
        </div>
      </Html>
    </group>
  );
}
