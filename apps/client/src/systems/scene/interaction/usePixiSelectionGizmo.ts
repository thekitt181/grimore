import { useEffect } from 'react';
import { Graphics } from 'pixi.js';
import { useMapStore } from '@/systems/map/store/mapStore';
import { useItemStore } from '../store/itemStore';
import { useSessionStore } from '@/store/sessionStore';
import { useLiveTransformStore } from '../store/liveTransformStore';
import { sceneRefs } from '../sceneRefs';
import { computeTokenGizmoLayout } from '../token/tokenGizmoLayout';
import { drawPixiSelectionGizmo, hidePixiSelectionGizmo } from './pixiSelectionGizmo';
import { syncTransformHandleRegistry } from './useTransformControls';
import type { Item } from '../types';

const EMPTY_LAYOUT = {
  mode: 'none' as const,
  cx: 0,
  cy: 0,
  width: 0,
  height: 0,
  rotation: 0,
  handles: [],
  boxCorners: [],
};

function manipulableSelected(items: Record<string, Item>, selectedIds: string[], gm: boolean): Item[] {
  return selectedIds
    .map((id) => items[id])
    .filter((it): it is Item => {
      if (!it || it.locked) return false;
      if (it.type === 'token') return it.visible !== false;
      return gm;
    });
}

/** Pixi selection gizmo for all 2D items — same layer/coords as map + flat tokens. */
export function usePixiSelectionGizmo(appReady: boolean) {
  const activeTool = useMapStore((s) => s.activeTool);
  const viewMode = useMapStore((s) => s.viewMode);
  const selectedIds = useItemStore((s) => s.selectedIds);
  const items = useItemStore((s) => s.items);
  const myRole = useSessionStore((s) => s.myRole);

  useEffect(() => {
    if (!appReady) return;

    // 3D gizmo + handle registry owned by Map3DTokenGizmo — do not clear here.
    if (viewMode !== '2d') return;

    const app = sceneRefs.app.current;
    const overlay = sceneRefs.overlay.current;
    if (!app || !overlay) return;

    let box = overlay.getChildByLabel('xf-box') as Graphics | null;
    if (!box) {
      box = new Graphics();
      box.label = 'xf-box';
      overlay.addChild(box);
    }
    let handlesG = overlay.getChildByLabel('xf-handles') as Graphics | null;
    if (!handlesG) {
      handlesG = new Graphics();
      handlesG.label = 'xf-handles';
      overlay.addChild(handlesG);
    }

    const tick = () => {
      const tool = useMapStore.getState().activeTool;
      const mode = useMapStore.getState().viewMode;
      if (mode !== '2d' || tool !== 'select') {
        hidePixiSelectionGizmo(box!, handlesG!);
        syncTransformHandleRegistry(EMPTY_LAYOUT);
        return;
      }

      const storeItems = useItemStore.getState().items;
      const selIds = useItemStore.getState().selectedIds;
      const gm = useSessionStore.getState().myRole === 'GM';
      const selected = manipulableSelected(storeItems, selIds, gm);
      const liveById = useLiveTransformStore.getState().byId;
      const layout = selected.length
        ? computeTokenGizmoLayout(selected, liveById, { moveOnly: !gm })
        : EMPTY_LAYOUT;

      syncTransformHandleRegistry(layout);
      drawPixiSelectionGizmo(box!, handlesG!, layout);
    };

    app.ticker.add(tick);
    return () => {
      app.ticker.remove(tick);
      hidePixiSelectionGizmo(box!, handlesG!);
    };
  }, [appReady, viewMode, activeTool, selectedIds, items, myRole]);
}
