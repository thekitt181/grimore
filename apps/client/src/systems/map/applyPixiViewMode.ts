import { isMobileClient } from '@/lib/socket';
import { sceneRefs } from '@/systems/scene/sceneRefs';
import { useMapStore } from './store/mapStore';

function usesDrawPreview(activeTool: string): boolean {
  return (
    activeTool === 'wall'
    || activeTool === 'calibrate'
    || activeTool.startsWith('draw-')
  );
}

/** Apply 2D/3D visibility on Pixi layers — call from useLayoutEffect so 3D never flashes 2D art. */
export function applyPixiViewMode(is3d: boolean): void {
  const app = sceneRefs.app.current;
  const world = sceneRefs.world.current;
  if (!app || !world) return;

  const mobile = isMobileClient();
  const activeTool = useMapStore.getState().activeTool;

  world.eventMode = is3d ? 'none' : 'static';

  app.renderer.background.alpha = 0;
  app.canvas.style.background = 'transparent';

  if (sceneRefs.fog.current) {
    sceneRefs.fog.current.alpha = is3d ? 0 : 1;
  }
  if (sceneRefs.measure.current) {
    const showMeasure = !is3d || activeTool === 'measure';
    sceneRefs.measure.current.alpha = showMeasure ? 1 : 0;
  }
  if (sceneRefs.drawPreview.current) {
    const showPreview = !is3d || usesDrawPreview(activeTool);
    sceneRefs.drawPreview.current.alpha = showPreview ? 1 : 0;
  }

  if (sceneRefs.items.current) {
    if (is3d && !mobile) {
      sceneRefs.items.current.alpha = 0;
      sceneRefs.items.current.visible = false;
    } else if (is3d && mobile) {
      // Keep map art in Pixi under the Three overlay — mobile WebGL can fail or size to 0.
      sceneRefs.items.current.alpha = 1;
      sceneRefs.items.current.visible = true;
      for (const child of sceneRefs.items.current.children) {
        if (child.label?.startsWith('walls_')) child.visible = false;
      }
    } else {
      sceneRefs.items.current.alpha = 1;
      sceneRefs.items.current.visible = true;
    }
  }

  if (sceneRefs.overlay.current) {
    sceneRefs.overlay.current.alpha = 1;
    for (const child of sceneRefs.overlay.current.children) {
      if (child.label === 'xf-box' || child.label === 'xf-handles') {
        child.visible = !is3d;
      }
    }
  }
}
