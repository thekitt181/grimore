import { Html } from '@react-three/drei';
import { useMemo } from 'react';
import type { TokenItem } from '@/systems/scene/types';
import { useItemStore, selectSortedItems } from '@/systems/scene/store/itemStore';
import { useMapStore } from '@/systems/map/store/mapStore';
import { itemCenterXZ, degToRad } from './coords';
import { useThreeTexture } from './useThreeTexture';
import { SceneModel } from './SceneModel';

/** Keep drei Html name tags a consistent screen size as the 3D camera zooms in/out. */
function useTokenLabelDistanceFactor(tokenSize: number): number {
  const viewport = useMapStore((s) => s.viewport);
  const items = useItemStore(selectSortedItems);
  const span = useMemo(() => {
    const maps = items.filter((i) => i.type === 'map' && i.visible);
    if (maps.length === 0) return 2560;
    return Math.max(...maps.map((m) => Math.max(m.width, m.height)));
  }, [items]);
  const cameraDist = (span * 0.85) / Math.max(viewport.scale, 0.08);
  return Math.max(cameraDist * 1.15, tokenSize * 2.5, 80);
}

function Token3DModel({
  token,
  activeTurn,
  orthographicLabels,
}: {
  token: TokenItem;
  activeTurn: boolean;
  orthographicLabels?: boolean;
}) {
  const [cx, cz] = itemCenterXZ(token);
  const targetSize = Math.min(token.width, token.height);
  const dynamicLabelFactor = useTokenLabelDistanceFactor(targetSize);
  const labelDistanceFactor = orthographicLabels ? 900 : dynamicLabelFactor;

  return (
    <group position={[cx, 0, cz]} rotation={[0, degToRad(token.rotation), 0]}>
      <SceneModel url={token.modelUrl!} targetSize={targetSize} groundAlign />

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

      <Html
        position={[0, targetSize * 0.65, 0]}
        center
        distanceFactor={labelDistanceFactor}
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

function Token3DMesh({
  token,
  activeTurn,
  orthographicLabels,
}: {
  token: TokenItem;
  activeTurn: boolean;
  orthographicLabels?: boolean;
}) {
  const { texture } = useThreeTexture(token.imageUrl);
  const [cx, cz] = itemCenterXZ(token);
  const radius = Math.min(token.width, token.height) / 2;
  const dynamicLabelFactor = useTokenLabelDistanceFactor(radius * 2);
  const labelDistanceFactor = orthographicLabels ? 900 : dynamicLabelFactor;
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
        distanceFactor={labelDistanceFactor}
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
  orthographicLabels,
}: {
  tokens: TokenItem[];
  activeTurnItemId?: string;
  /** Top-down 2D overlay — fixed Html label scale for orthographic camera. */
  orthographicLabels?: boolean;
}) {
  return (
    <group>
      {tokens.map((token) =>
        token.modelUrl ? (
          <Token3DModel
            key={token.id}
            token={token}
            activeTurn={token.id === activeTurnItemId}
            {...(orthographicLabels ? { orthographicLabels: true } : {})}
          />
        ) : (
          <Token3DMesh
            key={token.id}
            token={token}
            activeTurn={token.id === activeTurnItemId}
            {...(orthographicLabels ? { orthographicLabels: true } : {})}
          />
        ),
      )}
    </group>
  );
}
