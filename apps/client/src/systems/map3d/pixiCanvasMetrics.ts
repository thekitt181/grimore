import { isMobileClient } from '@/lib/socket';
import { sceneRefs } from '@/systems/scene/sceneRefs';

/** Must match `usePixiApp` resolution so Three overlay projection aligns with Pixi. */
export function pixiRenderResolution(): number {
  const mobile = isMobileClient();
  return mobile
    ? Math.min(window.devicePixelRatio || 1, 1.5)
    : Math.min(window.devicePixelRatio || 1, 2);
}

/** Pixi renderer screen size (resolution pixels, not CSS). */
export function pixiScreenSize(): { w: number; h: number } | null {
  const app = sceneRefs.app.current;
  if (!app || app.screen.width <= 0 || app.screen.height <= 0) return null;
  return { w: app.screen.width, h: app.screen.height };
}
