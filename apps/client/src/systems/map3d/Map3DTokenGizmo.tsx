import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Mesh } from 'three';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { useMapStore } from '@/systems/map/store/mapStore';
import { useSessionStore } from '@/store/sessionStore';
import { useLiveTransformStore } from '@/systems/scene/store/liveTransformStore';
import { computeTokenGizmoLayout } from '@/systems/scene/token/tokenGizmoLayout';
import { syncTransformHandleRegistry } from '@/systems/scene/interaction/useTransformControls';
import { objectBoundsInParentLocal, meshSubtreeBoundsInParentLocal } from './objectBoundsInParentLocal';
import type { Item, MapItem } from '@/systems/scene/types';
import type { GizmoHandleId, TokenGizmoLayout } from '@/systems/scene/token/tokenGizmoLayout';

const GOLD = '#c9a84c';
const HANDLE_Y = 0.12;
const BOX_Y = 0.06;
const MAX_HANDLES = 12;

const EMPTY_LAYOUT: TokenGizmoLayout = {
  mode: 'none',
  cx: 0,
  cy: 0,
  width: 0,
  height: 0,
  rotation: 0,
  handles: [],
  boxCorners: [],
};

const boxMat = new THREE.LineBasicMaterial({
  color: GOLD,
  transparent: true,
  opacity: 0.95,
  depthTest: false,
});

const ROT_DIST = 28;
const _gizmoModelBox = new THREE.Box3();
const _gizmoModelCenter = new THREE.Vector3();

function setBoxPoints(line: THREE.LineLoop, points: THREE.Vector3[]): void {
  if (points.length < 2) {
    line.visible = false;
    return;
  }
  line.visible = true;
  line.geometry.setFromPoints(points);
}

function localTokenHandlePositions(
  hw: number,
  hh: number,
  moveOnly: boolean,
): Array<{ id: GizmoHandleId; x: number; z: number }> {
  const minDim = Math.min(hw * 2, hh * 2);
  const compact = minDim < 96;
  const handleOutset = compact ? Math.max(12, minDim * 0.16) : Math.max(8, minDim * 0.08);
  const rotDist = compact ? Math.max(ROT_DIST, minDim * 0.55) : ROT_DIST;
  const handles: Array<{ id: GizmoHandleId; x: number; z: number }> = [
    { id: 'nw', x: -hw - handleOutset, z: -hh - handleOutset },
    { id: 'ne', x: hw + handleOutset, z: -hh - handleOutset },
    { id: 'se', x: hw + handleOutset, z: hh + handleOutset },
    { id: 'sw', x: -hw - handleOutset, z: hh + handleOutset },
  ];
  if (!moveOnly) {
    handles.push({ id: 'rotate', x: 0, z: -hh - rotDist });
  }
  return handles;
}

function applyModelBoundsGizmo(
  box: THREE.LineLoop | null,
  boxPts: React.MutableRefObject<THREE.Vector3[]>,
  modelRoot: THREE.Object3D,
  transformGroup: THREE.Object3D,
): { hw: number; hh: number; ox: number; oz: number } | null {
  transformGroup.updateWorldMatrix(true, true);
  const ok =
    meshSubtreeBoundsInParentLocal(modelRoot, transformGroup, _gizmoModelBox)
    || objectBoundsInParentLocal(modelRoot, transformGroup, _gizmoModelBox);
  if (!ok) return null;
  const { min, max } = _gizmoModelBox;
  const ox = (min.x + max.x) * 0.5;
  const oz = (min.z + max.z) * 0.5;
  const hw = Math.max((max.x - min.x) * 0.5, 4);
  const hh = Math.max((max.z - min.z) * 0.5, 4);
  const boxY = Math.max(min.y + 0.08, BOX_Y);
  if (box) {
    boxPts.current = [
      new THREE.Vector3(min.x, boxY, min.z),
      new THREE.Vector3(max.x, boxY, min.z),
      new THREE.Vector3(max.x, boxY, max.z),
      new THREE.Vector3(min.x, boxY, max.z),
      new THREE.Vector3(min.x, boxY, min.z),
    ];
    setBoxPoints(box, boxPts.current);
  }
  return { hw, hh, ox, oz };
}

/** Selection box + handles in item-local space — child of transform group (or model root). */
export function TokenSelectionGizmo({
  itemId,
  meshBaseWidth,
  meshBaseHeight,
  modelRootRef,
  fitToModelBounds = false,
}: {
  itemId: string;
  meshBaseWidth: number;
  meshBaseHeight: number;
  modelRootRef?: React.RefObject<THREE.Object3D | null>;
  /** Fit box/handles to loaded GLB bounds (maps) instead of item footprint + center offset. */
  fitToModelBounds?: boolean;
}) {
  const meshRefs = useRef<(Mesh | null)[]>([]);
  const boxRef = useRef<THREE.LineLoop>(null);
  const boxPts = useRef<THREE.Vector3[]>([]);

  useFrame(() => {
    const activeTool = useMapStore.getState().activeTool;
    const box = boxRef.current;
    if (activeTool !== 'select') {
      syncTransformHandleRegistry(EMPTY_LAYOUT);
      if (box) box.visible = false;
      for (const m of meshRefs.current) if (m) m.visible = false;
      return;
    }

    const items = useItemStore.getState().items;
    const item = items[itemId];
    if (!item) return;

    const liveById = useLiveTransformStore.getState().byId;
    const gm = useSessionStore.getState().myRole === 'GM';
    const layout = computeTokenGizmoLayout([item], liveById, { moveOnly: !gm });
    syncTransformHandleRegistry(layout);

    let hw = meshBaseWidth / 2;
    let hh = meshBaseHeight / 2;
    let ox = 0;
    let oz = 0;
    const model = modelRootRef?.current;
    const parent = box?.parent ?? meshRefs.current[0]?.parent ?? null;

    if (fitToModelBounds && model && parent && parent !== model) {
      const fitted = applyModelBoundsGizmo(box, boxPts, model, parent);
      if (fitted) {
        hw = fitted.hw;
        hh = fitted.hh;
        ox = fitted.ox;
        oz = fitted.oz;
      }
    } else if (model && parent && parent !== model && objectBoundsInParentLocal(model, parent, _gizmoModelBox)) {
      _gizmoModelBox.getCenter(_gizmoModelCenter);
      ox = _gizmoModelCenter.x;
      oz = _gizmoModelCenter.z;
      if (box) {
        boxPts.current = [
          new THREE.Vector3(-hw + ox, BOX_Y, -hh + oz),
          new THREE.Vector3(hw + ox, BOX_Y, -hh + oz),
          new THREE.Vector3(hw + ox, BOX_Y, hh + oz),
          new THREE.Vector3(-hw + ox, BOX_Y, hh + oz),
          new THREE.Vector3(-hw + ox, BOX_Y, -hh + oz),
        ];
        setBoxPoints(box, boxPts.current);
      }
    } else if (box) {
      boxPts.current = [
        new THREE.Vector3(-hw + ox, BOX_Y, -hh + oz),
        new THREE.Vector3(hw + ox, BOX_Y, -hh + oz),
        new THREE.Vector3(hw + ox, BOX_Y, hh + oz),
        new THREE.Vector3(-hw + ox, BOX_Y, hh + oz),
        new THREE.Vector3(-hw + ox, BOX_Y, -hh + oz),
      ];
      setBoxPoints(box, boxPts.current);
    }

    const localHandles = localTokenHandlePositions(hw, hh, !gm);
    let i = 0;
    for (const h of localHandles) {
      const mesh = meshRefs.current[i];
      if (!mesh) break;
      mesh.visible = true;
      mesh.position.set(h.x + ox, HANDLE_Y, h.z + oz);
      mesh.scale.setScalar(h.id === 'rotate' ? 1.25 : 1);
      i++;
    }
    for (; i < MAX_HANDLES; i++) {
      const mesh = meshRefs.current[i];
      if (mesh) mesh.visible = false;
    }
  });

  return (
    <>
      <lineLoop ref={boxRef} visible={false} renderOrder={20} frustumCulled={false}>
        <bufferGeometry />
        <primitive object={boxMat} attach="material" />
      </lineLoop>
      {Array.from({ length: MAX_HANDLES }, (_, i) => (
        <mesh key={i} ref={(m) => { meshRefs.current[i] = m; }} visible={false} renderOrder={20}>
          <boxGeometry args={[11, 11, 11]} />
          <meshStandardMaterial color={GOLD} emissive={GOLD} emissiveIntensity={0.3} depthTest={false} />
        </mesh>
      ))}
    </>
  );
}

function manipulableSelected(items: Record<string, Item>, selectedIds: string[], gm: boolean): Item[] {
  return selectedIds
    .map((id) => items[id])
    .filter((it): it is Item => {
      if (!it || it.locked) return false;
      if (it.type === 'token') return it.visible !== false;
      return gm;
    });
}

/** World-space gizmo for maps, handouts, and multi-select (not tokens). */
function WorldSelectionGizmo() {
  const meshRefs = useRef<(Mesh | null)[]>([]);
  const boxRef = useRef<THREE.LineLoop>(null);
  const boxPts = useRef<THREE.Vector3[]>([]);

  useFrame(() => {
    const activeTool = useMapStore.getState().activeTool;
    const storeItems = useItemStore.getState().items;
    const selectedIds = useItemStore.getState().selectedIds;
    const gm = useSessionStore.getState().myRole === 'GM';

    // GLB maps render an attached gizmo inside Map3DMapModel — never duplicate in world space.
    if (selectedIds.length === 1) {
      const sole = storeItems[selectedIds[0]!];
      if (sole?.type === 'map' && (sole as MapItem).modelUrl) {
        const box = boxRef.current;
        if (box) box.visible = false;
        for (const m of meshRefs.current) if (m) m.visible = false;
        return;
      }
    }

    const gizmoItems = manipulableSelected(storeItems, selectedIds, gm)
      .filter((it) => it.type !== 'token')
      .filter((it) => !(it.type === 'map' && (it as MapItem).modelUrl && selectedIds.length === 1));
    const liveById = useLiveTransformStore.getState().byId;
    const show = activeTool === 'select' && gizmoItems.length > 0;
    const layout = show ? computeTokenGizmoLayout(gizmoItems, liveById, { moveOnly: !gm }) : EMPTY_LAYOUT;

    syncTransformHandleRegistry(show && layout.mode !== 'none' ? layout : EMPTY_LAYOUT);

    const box = boxRef.current;
    if (!box || layout.mode === 'none' || layout.boxCorners.length < 4) {
      if (box) box.visible = false;
      for (const m of meshRefs.current) if (m) m.visible = false;
      return;
    }

    boxPts.current = layout.boxCorners.map((c) => new THREE.Vector3(c.x, BOX_Y, c.y));
    boxPts.current.push(boxPts.current[0]!.clone());
    setBoxPoints(box, boxPts.current);

    let i = 0;
    for (const h of layout.handles) {
      const mesh = meshRefs.current[i];
      if (!mesh) break;
      mesh.visible = true;
      mesh.position.set(h.wx, HANDLE_Y, h.wy);
      mesh.scale.setScalar(h.id === 'rotate' ? 1.25 : 1);
      i++;
    }
    for (; i < MAX_HANDLES; i++) {
      const mesh = meshRefs.current[i];
      if (mesh) mesh.visible = false;
    }
  });

  return (
    <>
      <lineLoop ref={boxRef} visible={false} renderOrder={20} frustumCulled={false}>
        <bufferGeometry />
        <primitive object={boxMat} attach="material" />
      </lineLoop>
      {Array.from({ length: MAX_HANDLES }, (_, i) => (
        <mesh key={i} ref={(m) => { meshRefs.current[i] = m; }} visible={false} renderOrder={20}>
          <boxGeometry args={[14, 14, 14]} />
          <meshStandardMaterial color={GOLD} emissive={GOLD} emissiveIntensity={0.35} depthTest={false} />
        </mesh>
      ))}
    </>
  );
}

/** Multi-select + single map/handout gizmo — tokens render gizmo inside Map3DTokens. */
export function Map3DTokenGizmo() {
  const activeTool = useMapStore((s) => s.activeTool);
  if (activeTool !== 'select') return null;
  return <WorldSelectionGizmo />;
}
