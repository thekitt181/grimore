import { useRef } from 'react';
import { Html } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

const LABEL_PX = 11;

/** Name tag locked to ~11px on screen, anchored above the token mesh. */
export function TokenNameLabel({ name, localY }: { name: string; localY: number }) {
  const anchorRef = useRef<THREE.Group>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const { camera, size } = useThree();

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
      pxScale = (LABEL_PX / size.height) * viewH / Math.max(dist, 1);
    } else {
      const persp = camera as THREE.PerspectiveCamera;
      const vFov = (persp.fov * Math.PI) / 180;
      pxScale = (LABEL_PX * 2 * dist * Math.tan(vFov / 2)) / size.height;
    }

    const scale = THREE.MathUtils.clamp(pxScale, 0.35, 1.4);
    el.style.transform = `translate(-50%, -100%) scale(${scale})`;
  });

  return (
    <group ref={anchorRef} position={[0, localY, 0]}>
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
            fontSize: `${LABEL_PX}px`,
            lineHeight: 1.2,
            padding: '2px 6px',
            borderRadius: 4,
            background: 'rgba(10,10,15,0.88)',
            color: '#e8e0d0',
            border: '1px solid rgba(201,168,76,0.35)',
            transformOrigin: '50% 100%',
          }}
        >
          {name}
        </div>
      </Html>
    </group>
  );
}
