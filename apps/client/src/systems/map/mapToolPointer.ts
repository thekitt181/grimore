import { clientToWorld, getMapInteractionEl } from '@/systems/scene/sceneRefs';

/** DOM target for map tool pointer handlers (interaction overlay, not the Pixi canvas). */
export function getMapToolElement(): HTMLElement | null {
  return getMapInteractionEl();
}

export { clientToWorld };
