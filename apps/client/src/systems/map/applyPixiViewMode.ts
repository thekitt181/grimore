import { isMobileClient } from '@/lib/socket';
import { sceneRefs } from '@/systems/scene/sceneRefs';
import { useMapStore } from './store/mapStore';
import { isThreeCanvasHealthy } from '@/systems/map3d/threeCanvasHealth';

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
  const { activeTool, gm2dEditorOpen } = useMapStore.getState();
  // GM 2D editor beside 3D keeps the full Pixi map live for real-time edits.
  const show2dEditor = is3d && gm2dEditorOpen;
  const hidePixiMaps = is3d && !mobile && !show2dEditor;
  const pixiTokenFallback = is3d && mobile && !isThreeCanvasHealthy();
  const hidePixiTokens = is3d && !pixiTokenFallback && !show2dEditor;

  world.eventMode = is3d && !show2dEditor ? 'none' : 'static';

  app.renderer.background.alpha = 0;
  // Transparent so the GM 2D-editor Three underlay (GLB top-down) shows through Pixi.
  app.canvas.style.background = 'transparent';

  if (sceneRefs.fog.current) {
    const showPixiFog = !is3d || show2dEditor;
    sceneRefs.fog.current.visible = showPixiFog;
    sceneRefs.fog.current.alpha = showPixiFog ? 1 : 0;
  }
  if (sceneRefs.measure.current) {
    const showMeasure = !is3d || show2dEditor || activeTool === 'measure';
    sceneRefs.measure.current.alpha = showMeasure ? 1 : 0;
  }
  if (sceneRefs.drawPreview.current) {
    const showPreview = !is3d || show2dEditor || usesDrawPreview(activeTool);
    sceneRefs.drawPreview.current.alpha = showPreview ? 1 : 0;
  }

  if (sceneRefs.items.current) {
    if (hidePixiMaps) {
      sceneRefs.items.current.alpha = 0;
      sceneRefs.items.current.visible = false;
    } else if (is3d && mobile && !show2dEditor) {
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

  if (sceneRefs.tokens.current) {
    if (hidePixiTokens) {
      sceneRefs.tokens.current.alpha = 0;
      sceneRefs.tokens.current.visible = false;
    } else {
      sceneRefs.tokens.current.alpha = 1;
      sceneRefs.tokens.current.visible = true;
    }
  }

  if (sceneRefs.overlay.current) {
    sceneRefs.overlay.current.alpha = 1;
    for (const child of sceneRefs.overlay.current.children) {
      if (child.label === 'xf-box' || child.label === 'xf-handles') {
        child.visible = !is3d || show2dEditor;
      }
    }
  }
}
