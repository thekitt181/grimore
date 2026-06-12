import { useMapStore } from '@/systems/map/store/mapStore';
import { sceneRefs } from '@/systems/scene/sceneRefs';
import { sceneCameraRef } from './sceneCameraRef';
import { worldXZToScreen } from './perspectiveCameraSync';
import type { TokenItem } from '@/systems/scene/types';

/** Screen-proximity token pick when 3D raycast misses (angled views / thin volumes). */
export function pickTokenAtScreen(clientX: number, clientY: number, tokens: TokenItem[]): string | null {
  const app = sceneRefs.app.current;
  const cam = sceneCameraRef.current;
  if (!app || cam?.type !== 'perspective' || useMapStore.getState().viewMode !== '3d') {
    return null;
  }

  const rect = app.canvas.getBoundingClientRect();
  const scale = Math.max(sceneRefs.world.current?.scale.x ?? useMapStore.getState().viewport.scale, 0.08);

  let bestId: string | null = null;
  let bestDist = Infinity;

  for (const token of tokens) {
    const cx = token.x + token.width / 2;
    const cz = token.y + token.height / 2;
    const screen = worldXZToScreen(cx, cz, rect, cam);
    const dx = clientX - screen.x;
    const dy = clientY - screen.y;
    const dist = Math.hypot(dx, dy);
    const hitPx = Math.max(28, Math.min(token.width, token.height) * 0.6 * scale);
    if (dist <= hitPx && dist < bestDist) {
      bestDist = dist;
      bestId = token.id;
    }
  }

  return bestId;
}
