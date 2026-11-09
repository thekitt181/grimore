import { Suspense, useLayoutEffect, useMemo, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { MAP_MODEL_YAW } from '@/systems/map3d/mapModelYaw';
import { resolvePropModel3D } from '@/systems/map3d/propModels3d';

export function PropCatalogPreview({
  propId,
  imageUrl,
  title,
}: {
  propId: string;
  imageUrl: string;
  title: string;
}) {
  const spec =
    imageUrl.includes('/kaykit/') || imageUrl.includes('/alstra/')
      ? resolvePropModel3D(propId)
      : null;

  return (
    <div
      className="relative w-full overflow-hidden rounded border border-[#2a2a3a]"
      style={{ height: 120, background: '#12121a' }}
    >
      <img
        src={imageUrl}
        alt=""
        draggable={false}
        className="absolute inset-0 m-auto max-h-full max-w-full object-contain p-2"
        style={{ imageRendering: spec ? 'auto' : 'pixelated' }}
      />
      {spec ? (
        <Canvas
          orthographic
          dpr={[1, 1.5]}
          frameloop="always"
          gl={{ antialias: true, alpha: true }}
          camera={{ position: [1.2, 1.35, 1.2], near: -200, far: 200, zoom: 40 }}
          style={{ width: '100%', height: '100%', pointerEvents: 'none', background: 'transparent' }}
        >
          <Suspense fallback={null}>
            <PropPreviewScene key={spec.resolvedUrl} url={spec.resolvedUrl} />
          </Suspense>
        </Canvas>
      ) : null}
      <div className="pointer-events-none absolute bottom-1 left-1.5 right-1.5 font-ui text-[10px] text-[#e8e0d0] truncate">
        {title}
      </div>
    </div>
  );
}

function PropPreviewScene({ url }: { url: string }) {
  const gltf = useGLTF(url);
  const wrapRef = useRef<THREE.Group>(null);
  const { camera, size, invalidate } = useThree();

  const root = useMemo(() => {
    const clone = gltf.scene.clone(true);
    clone.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map((m) => m.clone())
        : mesh.material.clone();
    });
    return clone;
  }, [gltf.scene]);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || !(camera instanceof THREE.OrthographicCamera)) return;
    wrap.position.set(0, 0, 0);
    wrap.scale.set(1, 1, 1);
    wrap.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(wrap);
    if (box.isEmpty()) return;
    const dim = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const max = Math.max(dim.x, dim.y, dim.z, 0.001);
    const s = 1 / max;
    wrap.scale.setScalar(s);
    wrap.position.copy(center).multiplyScalar(-s);
    camera.position.set(1.2, 1.35, 1.2);
    camera.near = -20;
    camera.far = 20;
    camera.lookAt(0, 0, 0);
    const view = Math.min(size.width, size.height);
    camera.zoom = view / 1.7;
    camera.updateProjectionMatrix();
    invalidate();
  }, [root, camera, size.width, size.height, invalidate]);

  return (
    <>
      <ambientLight intensity={0.9} color="#fff8ef" />
      <directionalLight position={[6, 10, 4]} intensity={1.55} color="#fff5e6" />
      <directionalLight position={[-4, 6, -3]} intensity={0.5} color="#ffd4a8" />
      <group ref={wrapRef} rotation={[0, MAP_MODEL_YAW, 0]}>
        <primitive object={root} />
      </group>
    </>
  );
}
