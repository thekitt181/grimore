import { useLayoutEffect, useState } from 'react';
import { groundHeightAt, useMapRaycastVersion } from './mapGroundRaycast';

const TOKEN_SURFACE_PAD = 0.12;

/** Snap token base to 3D map terrain (or y=0 on flat image maps). */
export function useTokenGroundY(x: number, z: number): number {
  const raycastVersion = useMapRaycastVersion();
  const [y, setY] = useState(TOKEN_SURFACE_PAD);

  useLayoutEffect(() => {
    setY(groundHeightAt(x, z, 0) + TOKEN_SURFACE_PAD);
  }, [x, z, raycastVersion]);

  return y;
}
