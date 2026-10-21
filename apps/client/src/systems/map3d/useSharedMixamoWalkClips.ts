import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import {
  SHARED_MIXAMO_WALK_URL,
  retargetMixamoClipToSkeleton,
} from './retargetMixamoWalk';

let cachedSrc: THREE.AnimationClip | null | undefined;
let loadPromise: Promise<THREE.AnimationClip | null> | null = null;

function loadSharedMixamoWalk(): Promise<THREE.AnimationClip | null> {
  if (cachedSrc !== undefined) return Promise.resolve(cachedSrc);
  if (loadPromise) return loadPromise;
  loadPromise = new Promise((resolve) => {
    const loader = new FBXLoader();
    loader.load(
      SHARED_MIXAMO_WALK_URL,
      (fbx) => {
        const clip = fbx.animations[0] ?? null;
        if (clip) clip.name = 'walk_unarmed_forward';
        cachedSrc = clip;
        resolve(clip);
      },
      undefined,
      () => {
        cachedSrc = null;
        resolve(null);
      },
    );
  });
  return loadPromise;
}

/**
 * Non-suspense Mixamo walk: loads once, retargets onto `root`, stable clip identity
 * so the AnimationMixer is not torn down every frame.
 */
export function useSharedMixamoWalkClips(root: THREE.Object3D | null): THREE.AnimationClip[] {
  const [clips, setClips] = useState<THREE.AnimationClip[]>([]);

  useEffect(() => {
    if (!root) {
      setClips([]);
      return;
    }
    let cancelled = false;
    void loadSharedMixamoWalk().then((src) => {
      if (cancelled || !src) return;
      const retargeted = retargetMixamoClipToSkeleton(src, root);
      if (!retargeted || cancelled) return;
      setClips([retargeted]);
    });
    return () => {
      cancelled = true;
    };
  }, [root]);

  return clips;
}
