import { useEffect } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { isFpSprayPainting, sampleFpSpray } from './fpSurfacePaint';
import { isFpBreaching, sampleFpBreach } from './fpWallBreach';
import { isFpErasing, sampleFpErase } from './fpEraseDecals';
import { fpSceneRef } from './fpSceneRef';

/** While LMB spray/breach/erase is held, sample the camera ray each frame. */
export function FpPaintSampler() {
  const scene = useThree((s) => s.scene);

  useEffect(() => {
    fpSceneRef.current = scene;
    return () => {
      if (fpSceneRef.current === scene) fpSceneRef.current = null;
    };
  }, [scene]);

  useFrame(() => {
    if (isFpSprayPainting()) sampleFpSpray(scene);
    if (isFpBreaching()) sampleFpBreach(scene);
    if (isFpErasing()) sampleFpErase(scene);
  });

  return null;
}
