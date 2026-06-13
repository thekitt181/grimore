import { useItemStore } from '@/systems/scene/store/itemStore';
import { useSessionStore } from '@/store/sessionStore';
import { tokenShowsHpBarToPlayer, type TokenItem } from '@/systems/scene/types';

const BAR_H = 6;

function hpFillColor(ratio: number): string {
  if (ratio > 0.5) return '#4ade80';
  if (ratio > 0.25) return '#facc15';
  return '#ef4444';
}

/** HP bar on the table plane — rotates with the token (local +Z = south at 0°). */
export function TokenHpBar({
  tokenId,
  footprint,
}: {
  tokenId: string;
  footprint: number;
}) {
  const token = useItemStore((s) => s.items[tokenId]) as TokenItem | undefined;
  const isGM = useSessionStore((s) => s.myRole === 'GM');

  if (!token || token.type !== 'token') return null;
  if (!isGM && !tokenShowsHpBarToPlayer(token)) return null;

  const maxHp = Math.max(1, token.maxHp);
  const hpRatio = Math.max(0, token.hp / maxHp);
  const tempRatio = Math.max(0, (token.tempHp ?? 0) / maxHp);
  const barW = Math.max(footprint - 8, 12);
  const offsetZ = footprint / 2 + 14;
  const fillW = barW * hpRatio;
  const tempW = Math.min(barW * tempRatio, barW - fillW);

  return (
    <group position={[0, 0.14, offsetZ]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={20}>
        <planeGeometry args={[barW, BAR_H]} />
        <meshBasicMaterial color="#8b1a1a" toneMapped={false} />
      </mesh>

      {hpRatio > 0 && (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[-(barW - fillW) / 2, 0.02, 0]}
          renderOrder={21}
        >
          <planeGeometry args={[fillW, BAR_H]} />
          <meshBasicMaterial color={hpFillColor(hpRatio)} toneMapped={false} />
        </mesh>
      )}

      {tempW > 0 && (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[-(barW - fillW * 2 - tempW) / 2, 0.03, 0]}
          renderOrder={22}
        >
          <planeGeometry args={[tempW, BAR_H]} />
          <meshBasicMaterial color="#60a5fa" toneMapped={false} />
        </mesh>
      )}
    </group>
  );
}
