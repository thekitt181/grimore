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
import { resolveItemBounds } from './sceneItemBounds';
import type { Item } from '@/systems/scene/types';
import type { TokenGizmoLayout } from '@/systems/scene/token/tokenGizmoLayout';

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

function rot(x: number, y: number, deg: number): { x: number; y: number } {
  const r = (deg * Math.PI) / 180;
  return { x: x * Math.cos(r) - y * Math.sin(r), y: x * Math.sin(r) + y * Math.cos(r) };
}

function setBoxPoints(line: THREE.LineLoop, points: THREE.Vector3[]): void {
  if (points.length < 2) {
    line.visible = false;
    return;
  }
  line.visible = true;
  line.geometry.setFromPoints(points);
}

/** Selection box + handles in item-local space — tokens only (child of transform group). */
export function TokenSelectionGizmo({
  itemId,
  meshBaseWidth,
  meshBaseHeight,
}: {
  itemId: string;
  meshBaseWidth: number;
  meshBaseHeight: number;
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
    const live = liveById[itemId];
    const b = resolveItemBounds(item, live);
    const layout = computeTokenGizmoLayout([item], liveById);
    syncTransformHandleRegistry(layout);

    const hw = meshBaseWidth / 2;
    const hh = meshBaseHeight / 2;
    const scaleX = meshBaseWidth > 0 ? b.width / meshBaseWidth : 1;
    const scaleZ = meshBaseHeight > 0 ? b.height / meshBaseHeight : 1;

    if (box) {
      boxPts.current = [
        new THREE.Vector3(-hw, BOX_Y, -hh),
        new THREE.Vector3(hw, BOX_Y, -hh),
        new THREE.Vector3(hw, BOX_Y, hh),
        new THREE.Vector3(-hw, BOX_Y, hh),
        new THREE.Vector3(-hw, BOX_Y, -hh),
      ];
      setBoxPoints(box, boxPts.current);
    }

    let i = 0;
    for (const h of layout.handles) {
      const mesh = meshRefs.current[i];
      if (!mesh) break;
      mesh.visible = true;
      const dx = h.wx - b.cx;
      const dz = h.wy - b.cz;
      const local = rot(dx, dz, -b.rotation);
      mesh.position.set(local.x / scaleX, HANDLE_Y, local.y / scaleZ);
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
      if (gm) return true;
      return it.type === 'token';
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
    const gizmoItems = manipulableSelected(storeItems, selectedIds, gm)
      .filter((it) => it.type !== 'token');
    const liveById = useLiveTransformStore.getState().byId;
    const show = activeTool === 'select' && gizmoItems.length > 0;
    const layout = show ? computeTokenGizmoLayout(gizmoItems, liveById) : EMPTY_LAYOUT;

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
