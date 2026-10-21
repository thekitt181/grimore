import { useRef, type ReactNode } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useMapStore } from '@/systems/map/store/mapStore';
import { useItemStore } from '@/systems/scene/store/itemStore';
import type { Group } from 'three';
import type { TokenItem } from '@/systems/scene/types';
import { is2dToken, is3dToken } from '@/systems/scene/token/tokenRenderType';
import { useThreeTexture } from './useThreeTexture';
import { SceneModel } from './SceneModel';
import { TokenPickVolume } from './TokenPickVolume';
import { TokenNameLabel } from './TokenNameLabel';
import { TokenHpBar } from './TokenHpBar';
import { TokenConditionDots } from './TokenConditionDots';
import { TokenTransformGroup } from './TokenTransformGroup';
import { TokenSelectionGizmo } from './Map3DTokenGizmo';
import { TABLE_MINI_VIEW_AZIMUTH_OFFSET } from './orthographicCameraSync';
import { tokenDisc } from '@/systems/scene/token/tokenGrid';
import { useFirstPersonStore } from './firstPersonStore';
import { isTokenVisibleInFpFog } from './fpTokenLosVisibility';
import { resolveTokenModelUrl } from './defaultTokenModel';

/** Hide tokens outside FP LOS when table fog is on (same rules as 2D fog). */
function FpLosTokenGate({
  token,
  children,
}: {
  token: TokenItem;
  children: ReactNode;
}) {
  const ref = useRef<Group>(null);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    g.visible = isTokenVisibleInFpFog(token);
  });
  return <group ref={ref}>{children}</group>;
}

/**
 * GLB forward is usually +Z; map north / FP walk at rotation 0 is -Z
 * (see yawForwardWorld). Spin the mini 180° so art faces the way it walks.
 * 2D keeps a tiny azimuth offset so tabletop preview matches the ortho camera.
 */
const MODEL_FACING_YAW_3D = Math.PI;
const MODEL_2D_IMPORT_YAW = Math.PI + TABLE_MINI_VIEW_AZIMUTH_OFFSET;
/** Tip the mini so a top-down 2D camera still reads depth / facing. */
const MODEL_2D_DISPLAY_PITCH = -0.58;

function parseBorderColor(hex: string | undefined): string {
  if (!hex) return '#c9a84c';
  return hex.startsWith('#') ? hex : `#${hex}`;
}

/** Mesh base size — updates when token is resized so pick/gizmo scale stays correct. */
function useTokenMeshBase(token: TokenItem) {
  const ref = useRef({ w: token.width, h: token.height });
  if (ref.current.w !== token.width || ref.current.h !== token.height) {
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

/**
 * 2D (image) token in the 3D scene — pedestal + upright portrait so first-person
 * / orbit reads as a stood-up mini, not a disc on the floor.
 * In FP the portrait billboards toward the camera (Y-axis only).
 */
function Token2DFlat({
  token,
  activeTurn,
  showGizmo,
  displayOnly = false,
}: {
  token: TokenItem;
  activeTurn: boolean;
  showGizmo: boolean;
  displayOnly?: boolean;
}) {
  const { texture } = useThreeTexture(token.imageUrl);
  const meshBase = useTokenMeshBase(token);
  const modelRootRef = useRef<Group>(null);
  const portraitRef = useRef<Group>(null);
  const targetSize = Math.min(meshBase.w, meshBase.h);
  const { radius, ring } = tokenDisc(targetSize);
  const borderColor = parseBorderColor(token.borderColour);
  const stretchX = meshBase.w / targetSize;
  const stretchZ = meshBase.h / targetSize;
  const baseRadius = targetSize * 0.46;
  const baseTopY = Math.max(baseRadius * 0.22, 3.5) * 0.78;
  const faceR = Math.max(0.5, radius - ring);
  const portraitH = faceR * 2.15;
  const portraitY = baseTopY + portraitH * 0.52;
  const firstPerson = useFirstPersonStore((s) => s.enabled);
  const { camera } = useThree();
  const billboardPos = useRef(new THREE.Vector3());
  const parentQuat = useRef(new THREE.Quaternion());
  const parentEuler = useRef(new THREE.Euler());

  useFrame(() => {
    const g = portraitRef.current;
    if (!g || displayOnly) return;
    if (!firstPerson) {
      // Face the token's own forward (parent already has yaw).
      g.rotation.set(0, 0, 0);
      return;
    }
    // Y-axis billboard — stand facing the FP camera.
    const parent = g.parent;
    if (!parent) return;
    parent.getWorldPosition(billboardPos.current);
    const dx = camera.position.x - billboardPos.current.x;
    const dz = camera.position.z - billboardPos.current.z;
    parent.getWorldQuaternion(parentQuat.current);
    parentEuler.current.setFromQuaternion(parentQuat.current, 'YXZ');
    const worldYaw = Math.atan2(dx, dz);
    g.rotation.set(0, worldYaw - parentEuler.current.y, 0);
  });

  // Underlay: lift above GLB map; lay flat so top-down matches classic 2D tokens.
  const surfaceY = displayOnly ? 48 : 'ground';

  return (
    <TokenTransformGroup
      itemId={token.id}
      surfaceY={surfaceY}
      scaleBaseWidth={meshBase.w}
      scaleBaseHeight={meshBase.h}
      displayOnly={displayOnly}
    >
      <group ref={modelRootRef} scale={[stretchX, 1, stretchZ]}>
        {displayOnly ? (
          <group rotation={[-Math.PI / 2, 0, 0]}>
            <mesh renderOrder={30}>
              <circleGeometry args={[faceR * 1.08, 48]} />
              <meshBasicMaterial color={borderColor} depthTest={false} />
            </mesh>
            <mesh position={[0, 0, 0.02]} renderOrder={31}>
              <circleGeometry args={[faceR, 48]} />
              <meshBasicMaterial color="#1c1c28" depthTest={false} />
            </mesh>
            {texture && (
              <mesh position={[0, 0, 0.04]} renderOrder={32}>
                <circleGeometry args={[faceR * 0.92, 48]} />
                <meshBasicMaterial map={texture} depthTest={false} toneMapped={false} />
              </mesh>
            )}
          </group>
        ) : (
          <>
            <MiniaturePedestal radius={baseRadius} borderColor={borderColor} />
            <group ref={portraitRef} position={[0, portraitY, 0]}>
              <mesh renderOrder={12} castShadow>
                <circleGeometry args={[faceR, 48]} />
                <meshStandardMaterial color="#1c1c28" roughness={0.85} metalness={0.05} side={THREE.DoubleSide} />
              </mesh>
              {texture && (
                <mesh position={[0, 0, 0.04]} renderOrder={13}>
                  <circleGeometry args={[faceR * 0.92, 48]} />
                  <meshStandardMaterial
                    map={texture}
                    transparent
                    roughness={0.55}
                    metalness={0.05}
                    depthWrite={false}
                    side={THREE.DoubleSide}
                  />
                </mesh>
              )}
              <mesh position={[0, 0, 0.02]} renderOrder={12}>
                <ringGeometry args={[faceR * 0.9, faceR, 48]} />
                <meshStandardMaterial color={borderColor} roughness={0.42} metalness={0.55} side={THREE.DoubleSide} />
              </mesh>
            </group>
            <TokenNameLabel name={token.name} footprint={targetSize} />
            <TokenHpBar tokenId={token.id} footprint={targetSize} />
            <TokenConditionDots tokenId={token.id} radius={radius} y={portraitY + faceR + 0.25} />
            {activeTurn && (
              <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, baseTopY + 0.08, 0]}>
                <ringGeometry args={[radius + ring * 0.4, radius + ring * 1.8, 48]} />
                <meshStandardMaterial color="#ffd700" emissive="#ffd700" emissiveIntensity={0.4} />
              </mesh>
            )}
          </>
        )}
      </group>

      {!displayOnly && (
        <TokenPickVolume
          itemId={token.id}
          radius={Math.max(meshBase.w, meshBase.h) * 0.52}
          height={Math.max(portraitY + faceR, 28)}
          modelRootRef={modelRootRef}
        />
      )}

      {showGizmo && !displayOnly && (
        <TokenSelectionGizmo
          itemId={token.id}
          meshBaseWidth={meshBase.w}
          meshBaseHeight={meshBase.h}
          modelRootRef={modelRootRef}
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
  displayOnly = false,
  modelUrl,
}: {
  token: TokenItem;
  activeTurn: boolean;
  view2d: boolean;
  showGizmo: boolean;
  displayOnly?: boolean;
  /** Resolved GLB (token.modelUrl or shared default walker). */
  modelUrl: string;
}) {
  const meshBase = useTokenMeshBase(token);
  const modelRootRef = useRef<Group>(null);
  const targetSize = Math.min(meshBase.w, meshBase.h);
  const storeToken = (useItemStore((s) => s.items[token.id]) ?? token) as TokenItem;
  const borderColor = parseBorderColor(token.borderColour);
  const baseRadius = targetSize * 0.46;
  const baseTopY = Math.max(baseRadius * 0.22, 3.5) * 0.78;
  // Underlay (displayOnly): lift above the GLB map so top-down minis aren't buried.
  const surfaceY = displayOnly ? 48 : view2d ? 0.06 : 'ground';
  const pickRadius = Math.max(meshBase.w, meshBase.h) * 0.52;
  const pickHeight = view2d ? targetSize * 1.85 : targetSize * 1.35;

  return (
    <TokenTransformGroup
      itemId={token.id}
      surfaceY={surfaceY}
      scaleBaseWidth={meshBase.w}
      scaleBaseHeight={meshBase.h}
      displayOnly={displayOnly}
    >
      {view2d && (
        <MiniaturePedestal radius={baseRadius} borderColor={borderColor} />
      )}
      <group
        ref={modelRootRef}
        position={[0, view2d ? baseTopY : 0, 0]}
        rotation={[
          view2d ? MODEL_2D_DISPLAY_PITCH : 0,
          view2d ? MODEL_2D_IMPORT_YAW : MODEL_FACING_YAW_3D,
          0,
        ]}
      >
        <SceneModel
          url={modelUrl}
          targetSize={targetSize}
          footprint={{ width: meshBase.w, height: meshBase.h }}
          groundAlign
          tokenRender
          tokenRender2d={view2d}
          {...(displayOnly ? {} : { itemId: token.id })}
        />
        <TokenNameLabel name={token.name} footprint={targetSize} />
        <TokenHpBar tokenId={token.id} footprint={targetSize} />
        <TokenConditionDots tokenId={token.id} radius={baseRadius} y={view2d ? 0.35 : 0.25} />

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
      </group>
      {!displayOnly && (
        <TokenPickVolume
          itemId={token.id}
          radius={pickRadius}
          height={pickHeight}
          modelRootRef={modelRootRef}
        />
      )}

      {showGizmo && !displayOnly && (
        <TokenSelectionGizmo
          itemId={token.id}
          meshBaseWidth={meshBase.w}
          meshBaseHeight={meshBase.h}
          modelRootRef={modelRootRef}
        />
      )}
    </TokenTransformGroup>
  );
}

function Token3DMesh({
  token,
  activeTurn,
  showGizmo,
  displayOnly = false,
}: {
  token: TokenItem;
  activeTurn: boolean;
  showGizmo: boolean;
  displayOnly?: boolean;
}) {
  const { texture } = useThreeTexture(token.imageUrl);
  const meshBase = useTokenMeshBase(token);
  const modelRootRef = useRef<Group>(null);
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
      displayOnly={displayOnly}
    >
      <group ref={modelRootRef} scale={[stretchX, 1, stretchZ]}>
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

      <TokenNameLabel name={token.name} footprint={targetSize} />
      <TokenHpBar tokenId={token.id} footprint={targetSize} />
      <TokenConditionDots tokenId={token.id} radius={radius} y={yTop + 0.3} />

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
      </group>

      {!displayOnly && (
        <TokenPickVolume
          itemId={token.id}
          radius={Math.max(meshBase.w, meshBase.h) * 0.52}
          height={pickHeight * 1.25}
          modelRootRef={modelRootRef}
        />
      )}

      {showGizmo && !displayOnly && (
        <TokenSelectionGizmo
          itemId={token.id}
          meshBaseWidth={meshBase.w}
          meshBaseHeight={meshBase.h}
          modelRootRef={modelRootRef}
        />
      )}
    </TokenTransformGroup>
  );
}

export function Map3DTokens({
  tokens,
  activeTurnItemId,
  showSelectionGizmo = true,
  /** Force tabletop mini posing (GM 2D editor underlay keeps viewMode 3d). */
  forceTabletop = false,
  /** Preview canvas — no pick volumes / pose registration. */
  displayOnly = false,
}: {
  tokens: TokenItem[];
  activeTurnItemId?: string;
  showSelectionGizmo?: boolean;
  forceTabletop?: boolean;
  displayOnly?: boolean;
}) {
  const modeIs2d = useMapStore((s) => s.viewMode) === '2d';
  const view2d = forceTabletop || modeIs2d;
  const activeTool = useMapStore((s) => s.activeTool);
  const selectedIds = useItemStore((s) => s.selectedIds);
  const firstPerson = useFirstPersonStore((s) => s.enabled);
  const gizmoTokenId =
    showSelectionGizmo
    && !firstPerson
    && activeTool === 'select'
    && selectedIds.length === 1
      ? selectedIds[0]
      : undefined;

  return (
    <group>
      {tokens.map((token) => {
        const activeTurn = token.id === activeTurnItemId;
        const showGizmo = token.id === gizmoTokenId;

        let body: ReactNode = null;

        // Only tokens that already have a GLB/STL use a 3D mini — never replace art with a default model.
        const modelUrl = resolveTokenModelUrl(token);

        if (modelUrl) {
          body = (
            <Token3DModel
              token={token}
              modelUrl={modelUrl}
              view2d={view2d}
              activeTurn={activeTurn}
              showGizmo={showGizmo}
              displayOnly={displayOnly}
            />
          );
        } else if (modeIs2d && !forceTabletop) {
          // Pure 2D map overlay: non-model tokens stay in Pixi.
          body = null;
        } else if (is2dToken(token)) {
          body = (
            <Token2DFlat
              token={token}
              activeTurn={activeTurn}
              showGizmo={showGizmo}
              displayOnly={displayOnly}
            />
          );
        } else if (is3dToken(token)) {
          body = (
            <Token3DMesh
              token={token}
              activeTurn={activeTurn}
              showGizmo={showGizmo}
              displayOnly={displayOnly}
            />
          );
        }

        if (!body) return null;

        if (displayOnly) {
          return <group key={token.id}>{body}</group>;
        }

        return (
          <FpLosTokenGate key={token.id} token={token}>
            {body}
          </FpLosTokenGate>
        );
      })}
    </group>
  );
}
