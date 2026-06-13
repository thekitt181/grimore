import { useRef } from 'react';
import { useMapStore } from '@/systems/map/store/mapStore';
import { useItemStore } from '@/systems/scene/store/itemStore';
import type { TokenItem } from '@/systems/scene/types';
import { is2dToken, is3dToken } from '@/systems/scene/token/tokenRenderType';
import { useThreeTexture } from './useThreeTexture';
import { SceneModel } from './SceneModel';
import { TokenPickVolume } from './TokenPickVolume';
import { TokenNameLabel } from './TokenNameLabel';
import { TokenHpBar } from './TokenHpBar';
import { TokenTransformGroup } from './TokenTransformGroup';
import { TokenSelectionGizmo } from './Map3DTokenGizmo';
import { TABLE_MINI_VIEW_AZIMUTH_OFFSET } from './orthographicCameraSync';

/** GLB forward axis: most minis face +Z; map north is -Z at rotation 0. */
const MODEL_2D_IMPORT_YAW = Math.PI + TABLE_MINI_VIEW_AZIMUTH_OFFSET;

function parseBorderColor(hex: string | undefined): string {
  if (!hex) return '#c9a84c';
  return hex.startsWith('#') ? hex : `#${hex}`;
}

/** Mesh normalized once at this size; live resize uses group scale (matches gizmo bounds). */
function useTokenMeshBase(token: TokenItem) {
  const ref = useRef<{ w: number; h: number } | null>(null);
  if (!ref.current) {
    ref.current = { w: token.width, h: token.height };
  }
  return ref.current;
}

/** Classic D&D-style round base + contact shadow for 2D map minis. */
function MiniaturePedestal({
  radius,
  borderColor = '#c9a84c',
}: {
  radius: number;
  borderColor?: string;
}) {
  const baseH = Math.max(radius * 0.22, 3.5);
  const lipH = baseH * 0.55;
  const topY = baseH * 0.78;

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]} renderOrder={8}>
        <circleGeometry args={[radius * 1.12, 40]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.32} depthWrite={false} />
      </mesh>

      <mesh position={[0, lipH * 0.5, 0]} castShadow receiveShadow={false} renderOrder={9}>
        <cylinderGeometry args={[radius * 0.9, radius * 1.05, lipH, 32]} />
        <meshStandardMaterial color="#141010" roughness={0.88} metalness={0.22} />
      </mesh>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, topY, 0]} renderOrder={10}>
        <circleGeometry args={[radius * 0.86, 32]} />
        <meshStandardMaterial color="#252018" roughness={0.78} metalness={0.15} />
      </mesh>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, topY + 0.04, 0]} renderOrder={11}>
        <ringGeometry args={[radius * 0.82, radius * 0.9, 32]} />
        <meshStandardMaterial color={borderColor} roughness={0.42} metalness={0.55} />
      </mesh>
    </group>
  );
}

/** Flat 2D-style token on the ground plane — used in 3D view only. */
function Token2DFlat({
  token,
  activeTurn,
  showGizmo,
}: {
  token: TokenItem;
  activeTurn: boolean;
  showGizmo: boolean;
}) {
  const { texture } = useThreeTexture(token.imageUrl);
  const meshBase = useTokenMeshBase(token);
  const targetSize = Math.min(meshBase.w, meshBase.h);
  const radius = targetSize / 2 - 4;
  const borderColor = parseBorderColor(token.borderColour);
  const stretchX = meshBase.w / targetSize;
  const stretchZ = meshBase.h / targetSize;

  return (
    <TokenTransformGroup
      itemId={token.id}
      surfaceY={0.06}
      scaleBaseWidth={meshBase.w}
      scaleBaseHeight={meshBase.h}
    >
      <group scale={[stretchX, 1, stretchZ]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow={false} renderOrder={10}>
        <circleGeometry args={[radius, 48]} />
        <meshStandardMaterial color="#1c1c28" roughness={0.85} metalness={0.05} />
      </mesh>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} renderOrder={11}>
        <ringGeometry args={[radius - 3, radius, 48]} />
        <meshStandardMaterial color={borderColor} roughness={0.45} metalness={0.35} />
      </mesh>

      {texture && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]} renderOrder={12}>
          <circleGeometry args={[radius - 5, 48]} />
          <meshStandardMaterial map={texture} transparent roughness={0.55} metalness={0.05} />
        </mesh>
      )}

      </group>

      <TokenPickVolume itemId={token.id} radius={Math.max(meshBase.w, meshBase.h) * 0.52} height={radius * 0.5} />
      <TokenNameLabel name={token.name} localY={radius * 0.85 * stretchZ} />
      <TokenHpBar tokenId={token.id} footprint={targetSize} />

      {activeTurn && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.08, 0]} scale={[stretchX, 1, stretchZ]}>
          <ringGeometry args={[radius + 2, radius + 8, 48]} />
          <meshStandardMaterial color="#ffd700" emissive="#ffd700" emissiveIntensity={0.4} />
        </mesh>
      )}

      {showGizmo && (
        <TokenSelectionGizmo
          itemId={token.id}
          meshBaseWidth={meshBase.w}
          meshBaseHeight={meshBase.h}
        />
      )}
    </TokenTransformGroup>
  );
}

function Token3DModel({
  token,
  activeTurn,
  view2d,
  showGizmo,
}: {
  token: TokenItem;
  activeTurn: boolean;
  view2d: boolean;
  showGizmo: boolean;
}) {
  const meshBase = useTokenMeshBase(token);
  const targetSize = Math.min(meshBase.w, meshBase.h);
  const storeToken = (useItemStore((s) => s.items[token.id]) ?? token) as TokenItem;
  const borderColor = parseBorderColor(token.borderColour);
  const baseRadius = targetSize * 0.46;
  const baseTopY = Math.max(baseRadius * 0.22, 3.5) * 0.78;
  const surfaceY = view2d ? 0.06 : 'ground';

  return (
    <TokenTransformGroup
      itemId={token.id}
      surfaceY={surfaceY}
      scaleBaseWidth={meshBase.w}
      scaleBaseHeight={meshBase.h}
    >
      {view2d && (
        <MiniaturePedestal radius={baseRadius} borderColor={borderColor} />
      )}
      {/* Upright on base — parent Y spin only; view orbit is camera right-drag when selected. */}
      <group position={[0, view2d ? baseTopY : 0, 0]} rotation={[0, view2d ? MODEL_2D_IMPORT_YAW : 0, 0]}>
        <SceneModel
          url={token.modelUrl!}
          targetSize={targetSize}
          footprint={{ width: meshBase.w, height: meshBase.h }}
          groundAlign
          tokenRender
          tokenRender2d={view2d}
        />
      </group>
      <TokenPickVolume itemId={token.id} radius={Math.max(meshBase.w, meshBase.h) * 0.52} height={view2d ? targetSize * 1.85 : targetSize * 1.35} />
      <TokenNameLabel name={token.name} localY={view2d ? targetSize * 1.35 : targetSize * 0.92} />
      <TokenHpBar tokenId={token.id} footprint={targetSize} />

      {activeTurn && view2d && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.12, 0]}>
          <ringGeometry args={[baseRadius * 1.02, baseRadius * 1.14, 40]} />
          <meshStandardMaterial color="#ffd700" emissive="#ffd700" emissiveIntensity={0.45} />
        </mesh>
      )}

      {activeTurn && !view2d && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, targetSize * 0.05, 0]}>
          <ringGeometry args={[targetSize * 0.48, targetSize * 0.55, 48]} />
          <meshStandardMaterial color="#c9a84c" emissive="#c9a84c" emissiveIntensity={0.35} />
        </mesh>
      )}

      {token.auraRadius != null && token.auraRadius > 0 && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.15, 0]}>
          <ringGeometry args={[targetSize * 0.45, targetSize * 0.45 + token.auraRadius * (storeToken.width / (storeToken.sizeCells || 1)), 48]} />
          <meshBasicMaterial
            color={token.auraColor ?? '#c9a84c'}
            transparent
            opacity={0.22}
            depthWrite={false}
          />
        </mesh>
      )}

      {showGizmo && (
        <TokenSelectionGizmo
          itemId={token.id}
          meshBaseWidth={meshBase.w}
          meshBaseHeight={meshBase.h}
        />
      )}
    </TokenTransformGroup>
  );
}

function Token3DMesh({
  token,
  activeTurn,
  showGizmo,
}: {
  token: TokenItem;
  activeTurn: boolean;
  showGizmo: boolean;
}) {
  const { texture } = useThreeTexture(token.imageUrl);
  const meshBase = useTokenMeshBase(token);
  const targetSize = Math.min(meshBase.w, meshBase.h);
  const storeToken = (useItemStore((s) => s.items[token.id]) ?? token) as TokenItem;
  const radius = targetSize / 2;
  const baseHeightMesh = Math.max(radius * 0.22, 4);
  const yTop = baseHeightMesh + 0.5;
  const pickHeight = yTop + radius * 0.5;
  const stretchX = meshBase.w / targetSize;
  const stretchZ = meshBase.h / targetSize;

  return (
    <TokenTransformGroup
      itemId={token.id}
      surfaceY="ground"
      scaleBaseWidth={meshBase.w}
      scaleBaseHeight={meshBase.h}
    >
      <group scale={[stretchX, 1, stretchZ]}>
      <mesh position={[0, baseHeightMesh / 2, 0]} castShadow receiveShadow={false} renderOrder={10}>
        <cylinderGeometry args={[radius, radius * 1.05, baseHeightMesh, 32]} />
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
      </group>

      <TokenPickVolume itemId={token.id} radius={Math.max(meshBase.w, meshBase.h) * 0.52} height={pickHeight * 1.25} />
      <TokenNameLabel name={token.name} localY={(yTop + radius * 0.75) * stretchZ} />
      <TokenHpBar tokenId={token.id} footprint={targetSize} />

      {activeTurn && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, yTop + 0.35, 0]}>
          <ringGeometry args={[radius * 1.05, radius * 1.18, 48]} />
          <meshStandardMaterial color="#c9a84c" emissive="#c9a84c" emissiveIntensity={0.35} />
        </mesh>
      )}

      {token.auraRadius != null && token.auraRadius > 0 && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.15, 0]}>
          <ringGeometry args={[radius, radius + token.auraRadius * (storeToken.width / (storeToken.sizeCells || 1)), 48]} />
          <meshBasicMaterial
            color={token.auraColor ?? '#c9a84c'}
            transparent
            opacity={0.22}
            depthWrite={false}
          />
        </mesh>
      )}

      {showGizmo && (
        <TokenSelectionGizmo
          itemId={token.id}
          meshBaseWidth={meshBase.w}
          meshBaseHeight={meshBase.h}
        />
      )}
    </TokenTransformGroup>
  );
}

export function Map3DTokens({
  tokens,
  activeTurnItemId,
  showSelectionGizmo = true,
}: {
  tokens: TokenItem[];
  activeTurnItemId?: string;
  showSelectionGizmo?: boolean;
}) {
  const view2d = useMapStore((s) => s.viewMode) === '2d';
  const activeTool = useMapStore((s) => s.activeTool);
  const selectedIds = useItemStore((s) => s.selectedIds);
  const gizmoTokenId =
    showSelectionGizmo && activeTool === 'select' && selectedIds.length === 1
      ? selectedIds[0]
      : undefined;

  return (
    <group>
      {tokens.map((token) => {
        const activeTurn = token.id === activeTurnItemId;
        const showGizmo = token.id === gizmoTokenId;

        if (is2dToken(token)) {
          return (
            <Token2DFlat
              key={token.id}
              token={token}
              activeTurn={activeTurn}
              showGizmo={showGizmo}
            />
          );
        }

        if (!is3dToken(token)) return null;

        return token.modelUrl ? (
          <Token3DModel
            key={token.id}
            token={token}
            view2d={view2d}
            activeTurn={activeTurn}
            showGizmo={showGizmo}
          />
        ) : (
          <Token3DMesh
            key={token.id}
            token={token}
            activeTurn={activeTurn}
            showGizmo={showGizmo}
          />
        );
      })}
    </group>
  );
}
