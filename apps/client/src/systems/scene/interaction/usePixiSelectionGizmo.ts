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
import { itemSelectionGizmoRendersInThree } from '../token/tokenRenderType';
import { playerCanRotateToken } from '../token/clientTokenVisibility';

function manipulableSelected(items: Record<string, Item>, selectedIds: string[], gm: boolean): Item[] {
  return selectedIds
    .map((id) => items[id])
    .filter((it): it is Item => {
      if (!it || it.locked) return false;
      if (it.type === 'token') return it.visible !== false;
      if (it.type === 'image' || it.type === 'handout') return gm;
      return gm;
    });
}

/** Pixi selection gizmo for flat 2D items — GLB/3D tokens use the Three.js gizmo instead. */
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
        return;
      }

      const storeItems = useItemStore.getState().items;
      const selIds = useItemStore.getState().selectedIds;
      const gm = useSessionStore.getState().myRole === 'GM';
      const selected = manipulableSelected(storeItems, selIds, gm).filter(
        (it) => !itemSelectionGizmoRendersInThree(it, mode),
      );
      const liveById = useLiveTransformStore.getState().byId;

      if (selected.length === 0) {
        hidePixiSelectionGizmo(box!, handlesG!);
        return;
      }

      let handleMode: 'move' | 'rotate' | 'all' = gm ? 'all' : 'move';
      if (!gm && selected.length === 1 && selected[0]?.type === 'token') {
        const myUserId = useSessionStore.getState().myUserId;
        if (playerCanRotateToken(selected[0] as any, myUserId)) handleMode = 'rotate';
      }

      const layout = computeTokenGizmoLayout(selected, liveById, { handleMode });
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
