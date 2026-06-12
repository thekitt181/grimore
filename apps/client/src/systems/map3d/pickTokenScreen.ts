import { is3dToken } from '@/systems/scene/token/tokenRenderType';
import { sceneRefs } from '@/systems/scene/sceneRefs';
import { pixiClientToWorld } from './pixiScreenCoords';
import type { TokenItem } from '@/systems/scene/types';

/** Screen pick for 3D tokens (Three.js layer on top). */
export function pickTokenAtScreen(clientX: number, clientY: number, tokens: TokenItem[]): string | null {
  const world = sceneRefs.world.current;
  if (!world) return null;

  const { x: clickWx, y: clickWy } = pixiClientToWorld(clientX, clientY);
  const scale = Math.max(world.scale.x, 0.08);
  const pad = 8 / scale;

  for (const token of tokens) {
    if (!is3dToken(token)) continue;
    if (
      clickWx >= token.x - pad && clickWx <= token.x + token.width + pad
      && clickWy >= token.y - pad && clickWy <= token.y + token.height + pad
    ) {
      return token.id;
    }
  }

  let bestId: string | null = null;
  let bestDist = Infinity;
  for (const token of tokens) {
    if (!is3dToken(token)) continue;
    const cx = token.x + token.width / 2;
    const cz = token.y + token.height / 2;
    const dist = Math.hypot(clickWx - cx, clickWy - cz);
    const hitWorld = Math.max(token.width, token.height) * 0.55 + pad;
    if (dist <= hitWorld && dist < bestDist) {
      bestDist = dist;
      bestId = token.id;
    }
  }

  return bestId;
}
