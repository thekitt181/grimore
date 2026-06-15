import { pickHandle } from '@/systems/scene/interaction/useTransformControls';
import { pickInteractableTokenAt } from './pickInteractableToken';

/** Whether the pointer is over a token (raycast or screen bounds fallback). */
export function pointerHitsToken(clientX: number, clientY: number): boolean {
  if (pickHandle(clientX, clientY)) return true;
  return pickInteractableTokenAt(clientX, clientY) != null;
}
