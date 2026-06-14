import { useMemo } from 'react';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { tokenConditionColor } from '@/systems/scene/token/tokenConditionColors';

/** Coloured dots orbiting the token — mirrors Pixi overlay condition badges. */
export function TokenConditionDots({
  tokenId,
  radius,
  y = 0.22,
}: {
  tokenId: string;
  radius: number;
  y?: number;
}) {
  const conditions = useItemStore((s) => {
    const item = s.items[tokenId];
    return item?.type === 'token' ? item.conditions : [];
  });

  const dots = useMemo(() => {
    const count = conditions.length;
    if (count === 0) return [];

    const dotR = Math.max(0.12, radius * 0.07);
    const orbit = radius + dotR + 2;
    const step = count === 1 ? 0 : (Math.PI * 2) / count;

    return conditions.map((cond, i) => {
      const angle = -Math.PI / 2 + i * step;
      return {
        key: `${cond}-${i}`,
        x: orbit * Math.cos(angle),
        z: orbit * Math.sin(angle),
        color: tokenConditionColor(cond),
        dotR,
      };
    });
  }, [conditions, radius]);

  if (dots.length === 0) return null;

  return (
    <group>
      {dots.map((dot) => (
        <mesh key={dot.key} position={[dot.x, y, dot.z]} renderOrder={25}>
          <sphereGeometry args={[dot.dotR, 10, 10]} />
          <meshBasicMaterial color={dot.color} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}
