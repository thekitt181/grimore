import { useEffect } from 'react';
import { useGLTF } from '@react-three/drei';
import { SceneModel } from './SceneModel';
import {
  resolvePropModel3D,
  hasPropModel3D,
  allPropModelUrls,
  type PropModelSpec,
} from './propModels3d';

/** Textured KayKit GLB fitted to the prop footprint (motion via PropAnim3D). */
export function PropModel3D({
  propId,
  open = false,
  size = 1,
}: {
  propId: string;
  open?: boolean;
  size?: number;
}) {
  const spec = resolvePropModel3D(propId, open);
  if (!spec) return null;

  const footprint = Math.max(size, 8);
  const targetSize = footprint * (spec.sizeBias ?? 1);

  return (
    <SceneModel
      url={spec.resolvedUrl}
      targetSize={targetSize}
      groundAlign
      tokenRender
      footprint={{ width: footprint, height: footprint }}
    />
  );
}

export function propModelLight(
  propId: string | undefined,
): PropModelSpec['light'] | undefined {
  if (!propId) return undefined;
  return resolvePropModel3D(propId, false)?.light;
}

export function preloadPropModels3D(): void {
  useGLTF.setDecoderPath('/draco/');
  for (const url of allPropModelUrls()) {
    useGLTF.preload(url, true, true);
  }
}

export function PropModelsPreload() {
  useEffect(() => {
    preloadPropModels3D();
  }, []);
  return null;
}

export { hasPropModel3D };
