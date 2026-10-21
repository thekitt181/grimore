import type { ImageItem, TokenItem } from '@/systems/scene/types';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { useSessionStore } from '@/store/sessionStore';
import { useFirstPersonStore } from '@/systems/map3d/firstPersonStore';
import { resolveFirstPersonToken } from '@/systems/map3d/resolveFirstPersonToken';
import {
  armPropForDdbRoll,
  canUsePropUnderToken,
  propNextCheckKind,
  propRevealCheckLabel,
  propActivateCheckLabel,
  triggerDungeonPropAsync,
  triggerablePropUnderToken,
} from './dungeonProps';
import {
  usePropInteractRequestStore,
  type PropInteractResolveAction,
} from './propInteractRequestStore';
import { emitPropInteractRequest, emitPropInteractResolve } from './propInteractSync';

function newRequestId(): string {
  return `pi-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Triggerable prop in FP range — hidden props never interact (even for GM). */
export function fpInteractPropForToken(token: TokenItem, gm: boolean): ImageItem | null {
  const prop = triggerablePropUnderToken(token, gm);
  if (!prop || prop.visible === false) return null;
  return prop;
}

export function openGmPropInteractPrompt(req: {
  requestId: string;
  propItemId: string;
  actorTokenId: string;
  requesterUserId: string;
  requesterName: string;
  propName: string;
  at: number;
}): void {
  usePropInteractRequestStore.getState().pushGmRequest(req);
}

async function executePropInteractAction(
  propItemId: string,
  actorTokenId: string,
  action: PropInteractResolveAction,
): Promise<void> {
  const prop = useItemStore.getState().items[propItemId];
  const actor = useItemStore.getState().items[actorTokenId];
  if (prop?.type !== 'image' || actor?.type !== 'token') return;

  switch (action) {
    case 'deny':
      return;
    case 'use':
      await triggerDungeonPropAsync(prop, { actor, skipRoll: true });
      return;
    case 'roll-vtt':
      await triggerDungeonPropAsync(prop, { actor });
      return;
    case 'roll-ddb':
      armPropForDdbRoll(prop, actor);
      return;
    default:
      return;
  }
}

export function resolvePropInteractRequest(
  requestId: string,
  action: PropInteractResolveAction,
): void {
  if (useSessionStore.getState().myRole !== 'GM') return;
  const pending = usePropInteractRequestStore.getState().gmPending;
  if (!pending || pending.requestId !== requestId) return;
  const sessionId = useSessionStore.getState().sessionId;
  if (sessionId) {
    emitPropInteractResolve(sessionId, requestId, action);
  }
  ingestPropInteractResolve(requestId, action);
}

export function ingestPropInteractResolve(requestId: string, action: PropInteractResolveAction): void {
  const store = usePropInteractRequestStore.getState();
  const gmPending = store.gmPending?.requestId === requestId ? store.gmPending : null;
  if (store.playerWaiting?.requestId === requestId) {
    store.clearPlayerWaiting(requestId);
  }
  if (gmPending) store.clearGmRequest(requestId);
  if (action === 'deny' || !gmPending) return;
  void executePropInteractAction(gmPending.propItemId, gmPending.actorTokenId, action);
}

export function propInteractCheckHint(item: ImageItem): string | null {
  const kind = propNextCheckKind(item);
  if (kind === 'reveal') {
    const label = propRevealCheckLabel(item);
    const dc = item.propRevealDc ?? 0;
    return label && dc > 0 ? `${label} DC ${dc}` : 'Reveal check';
  }
  if (kind === 'activate') {
    const label = propActivateCheckLabel(item);
    const dc = item.propActivateDc ?? 0;
    return label && dc > 0 ? `${label} DC ${dc}` : 'Open check';
  }
  return null;
}

/** Press E in first person — request DM approval or open GM prompt. */
export function tryFirstPersonPropInteract(): boolean {
  if (!useFirstPersonStore.getState().enabled) return false;
  const token = resolveFirstPersonToken();
  if (!token || !canUsePropUnderToken(token)) return false;

  const gm = useSessionStore.getState().myRole === 'GM';
  const prop = fpInteractPropForToken(token, gm);
  if (!prop) return false;

  const requestId = newRequestId();
  const requesterUserId = useSessionStore.getState().myUserId ?? 'local';
  const requesterName = token.name?.trim() || (gm ? 'DM' : 'Player');
  const payload = {
    requestId,
    propItemId: prop.id,
    actorTokenId: token.id,
    requesterUserId,
    requesterName,
    propName: prop.name,
    at: Date.now(),
  };

  if (gm) {
    openGmPropInteractPrompt(payload);
    return true;
  }

  const sessionId = useSessionStore.getState().sessionId;
  if (!sessionId) return false;
  usePropInteractRequestStore.getState().setPlayerWaiting({
    requestId,
    propName: prop.name,
  });
  emitPropInteractRequest(sessionId, payload);
  return true;
}
