import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { PointLight } from 'three';
import { getActiveMap, useItemStore } from '@/systems/scene/store/itemStore';
import { GRIMOIRE_LIGHT_NAME, itemLightSpec, lightRadiusPx } from '@/systems/scene/sceneLights';

/** Follows a token or prop. Named so first-person fog does not mute it. */
export function AttachedSceneLight({ itemId }: { itemId: string }) {
  const ref = useRef<PointLight>(null);

  useFrame(({ clock }) => {
    const light = ref.current;
    if (!light) return;
    const item = useItemStore.getState().items[itemId];
    const spec = itemLightSpec(item);
    if (!spec) {
      light.visible = false;
      light.intensity = 0;
      return;
    }
    const grid = getActiveMap()?.gridSize ?? 70;
    const now = clock.elapsedTime;
    let intensity = spec.intensity;
    if (spec.flicker) {
      intensity *= 0.82 + Math.sin(now * 9.2) * 0.1 + Math.sin(now * 14.1 + 1.7) * 0.08;
    }
    light.color.set(spec.color);
    light.distance = lightRadiusPx(spec, grid);
    light.intensity = intensity;
    light.visible = true;
    const lift = item?.type === 'token'
      ? Math.max(10, Math.min(item.width, item.height) * 0.55)
      : Math.max(10, (item?.height ?? 24) * 0.45);
    light.position.set(0, lift, 0);
  });

  return (
    <pointLight
      ref={ref}
      name={GRIMOIRE_LIGHT_NAME}
      color="#ffc078"
      intensity={0}
      distance={120}
      decay={2}
      position={[0, 12, 0]}
      visible={false}
    />
  );
}
