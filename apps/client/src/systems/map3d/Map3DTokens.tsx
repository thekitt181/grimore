import { Html } from '@react-three/drei';
import type { TokenItem } from '@/systems/scene/types';
import { itemCenterXZ, degToRad } from './coords';
import { useThreeTexture } from './useThreeTexture';

function Token3DMesh({ token, activeTurn }: { token: TokenItem; activeTurn: boolean }) {
  const { texture } = useThreeTexture(token.imageUrl);
  const [cx, cz] = itemCenterXZ(token);
  const radius = Math.min(token.width, token.height) / 2;
  const baseHeight = Math.max(radius * 0.22, 4);
  const yTop = baseHeight + 0.5;

  return (
    <group position={[cx, 0, cz]} rotation={[0, degToRad(token.rotation), 0]}>
      <mesh position={[0, baseHeight / 2, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[radius, radius * 1.05, baseHeight, 32]} />
        <meshStandardMaterial color="#2a2018" roughness={0.7} metalness={0.25} />
      </mesh>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, yTop, 0]} castShadow>
        <circleGeometry args={[radius * 0.92, 48]} />
        <meshStandardMaterial
          {...(texture ? { map: texture } : {})}
          color={texture ? '#ffffff' : '#c9a84c'}
          roughness={0.55}
          metalness={0.1}
        />
      </mesh>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, yTop + 0.2, 0]}>
        <ringGeometry args={[radius * 0.95, radius * 1.02, 48]} />
        <meshStandardMaterial color="#c9a84c" roughness={0.4} metalness={0.6} />
      </mesh>

      {activeTurn && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, yTop + 0.35, 0]}>
          <ringGeometry args={[radius * 1.05, radius * 1.18, 48]} />
          <meshStandardMaterial color="#c9a84c" emissive="#c9a84c" emissiveIntensity={0.35} />
        </mesh>
      )}

      {token.auraRadius != null && token.auraRadius > 0 && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.15, 0]}>
          <ringGeometry args={[radius, radius + token.auraRadius * (token.width / (token.sizeCells || 1)), 48]} />
          <meshBasicMaterial
            color={token.auraColor ?? '#c9a84c'}
            transparent
            opacity={0.22}
            depthWrite={false}
          />
        </mesh>
      )}

      <Html
        position={[0, yTop + radius * 0.8, 0]}
        center
        distanceFactor={Math.max(radius * 2.5, 80)}
        style={{ pointerEvents: 'none', userSelect: 'none' }}
      >
        <span
          className="font-ui text-xs px-1.5 py-0.5 rounded whitespace-nowrap"
          style={{
            background: 'rgba(10,10,15,0.82)',
            color: '#e8e0d0',
            border: '1px solid rgba(201,168,76,0.35)',
          }}
        >
          {token.name}
        </span>
      </Html>
    </group>
  );
}

export function Map3DTokens({
  tokens,
  activeTurnItemId,
}: {
  tokens: TokenItem[];
  activeTurnItemId?: string;
}) {
  return (
    <group>
      {tokens.map((token) => (
        <Token3DMesh
          key={token.id}
          token={token}
          activeTurn={token.id === activeTurnItemId}
        />
      ))}
    </group>
  );
}
