import type { TokenItem } from '@/systems/scene/types';
import { itemCenterXZ, degToRad } from './coords';
import { useThreeTexture } from './useThreeTexture';
import { SceneModel } from './SceneModel';
import { useTokenGroundY } from './useTokenGroundY';
import { TokenPickVolume } from './TokenPickVolume';
import { TokenNameLabel } from './TokenNameLabel';

function Token3DModel({ token, activeTurn }: { token: TokenItem; activeTurn: boolean }) {
  const [cx, cz] = itemCenterXZ(token);
  const groundY = useTokenGroundY(cx, cz);
  const targetSize = Math.min(token.width, token.height);

  return (
    <group position={[cx, groundY, cz]} rotation={[0, degToRad(token.rotation), 0]}>
      <SceneModel url={token.modelUrl!} targetSize={targetSize} groundAlign tokenRender />
      <TokenPickVolume itemId={token.id} radius={targetSize / 2} height={targetSize} />
      <TokenNameLabel name={token.name} localY={targetSize * 0.92} />

      {activeTurn && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, targetSize * 0.05, 0]}>
          <ringGeometry args={[targetSize * 0.48, targetSize * 0.55, 48]} />
          <meshStandardMaterial color="#c9a84c" emissive="#c9a84c" emissiveIntensity={0.35} />
        </mesh>
      )}

      {token.auraRadius != null && token.auraRadius > 0 && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.15, 0]}>
          <ringGeometry args={[targetSize * 0.45, targetSize * 0.45 + token.auraRadius * (token.width / (token.sizeCells || 1)), 48]} />
          <meshBasicMaterial
            color={token.auraColor ?? '#c9a84c'}
            transparent
            opacity={0.22}
            depthWrite={false}
          />
        </mesh>
      )}
    </group>
  );
}

function Token3DMesh({ token, activeTurn }: { token: TokenItem; activeTurn: boolean }) {
  const { texture } = useThreeTexture(token.imageUrl);
  const [cx, cz] = itemCenterXZ(token);
  const groundY = useTokenGroundY(cx, cz);
  const radius = Math.min(token.width, token.height) / 2;
  const baseHeight = Math.max(radius * 0.22, 4);
  const yTop = baseHeight + 0.5;
  const pickHeight = yTop + radius * 0.5;

  return (
    <group position={[cx, groundY, cz]} rotation={[0, degToRad(token.rotation), 0]}>
      <mesh position={[0, baseHeight / 2, 0]} castShadow receiveShadow={false} renderOrder={10}>
        <cylinderGeometry args={[radius, radius * 1.05, baseHeight, 32]} />
        <meshStandardMaterial color="#2a2018" roughness={0.7} metalness={0.25} />
      </mesh>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, yTop, 0]} castShadow receiveShadow={false} renderOrder={10}>
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

      <TokenPickVolume itemId={token.id} radius={radius * 0.95} height={pickHeight} />
      <TokenNameLabel name={token.name} localY={yTop + radius * 0.75} />

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
      {tokens.map((token) =>
        token.modelUrl ? (
          <Token3DModel
            key={token.id}
            token={token}
            activeTurn={token.id === activeTurnItemId}
          />
        ) : (
          <Token3DMesh
            key={token.id}
            token={token}
            activeTurn={token.id === activeTurnItemId}
          />
        ),
      )}
    </group>
  );
}
