import { isMobileClient } from '@/lib/socket';
import { sceneRefs } from '@/systems/scene/sceneRefs';

/** Apply 2D/3D visibility on Pixi layers — call from useLayoutEffect so 3D never flashes 2D art. */
export function applyPixiViewMode(is3d: boolean): void {
  const app = sceneRefs.app.current;
  const world = sceneRefs.world.current;
  if (!app || !world) return;

  const mobile = isMobileClient();

  world.eventMode = is3d ? 'none' : 'static';

  app.renderer.background.alpha = 0;
  app.canvas.style.background = 'transparent';

  for (const layer of [
    sceneRefs.fog.current,
    sceneRefs.measure.current,
    sceneRefs.drawPreview.current,
  ]) {
    if (layer) layer.alpha = is3d ? 0 : 1;
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
  if (sceneRefs.fog.current) {
    sceneRefs.fog.current.alpha = is3d ? 0 : 1;
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
