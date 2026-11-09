import type { ImageItem, MapItem, TokenItem } from '@/systems/scene/types';
import { itemCenter } from '@/systems/scene/types';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { useSessionStore } from '@/store/sessionStore';
import { isModularGate, pieceForUrl } from '@/systems/map/library/modularKits';
import { emitItemUpdate } from '@/systems/scene/sceneSync';
import { useFirstPersonStore } from '@/systems/map3d/firstPersonStore';
import { firstPersonLook } from '@/systems/map3d/firstPersonLook';
import { yawForwardWorld } from '@/systems/map3d/firstPersonMove';
import { resolveFirstPersonToken } from '@/systems/map3d/resolveFirstPersonToken';
import {
  playerStatTarget,
  recordObjectInteract,
  resolveStatUserRef,
  resolveTokenStatUser,
} from '@/systems/stats/statMaker';
import {
  armPropForDdbRoll,
  canTriggerProp,
  canUsePropUnderToken,
  distanceTokenToPropFeet,
  FP_PROP_INTERACT_RANGE_FT,
  propNextCheckKind,
  propRevealCheckLabel,
  propActivateCheckLabel,
  resolvePropId,
  triggerDungeonPropAsync,
} from './dungeonProps';
import {
  usePropInteractRequestStore,
  type PropInteractResolveAction,
} from './propInteractRequestStore';
import { emitPropInteractRequest, emitPropInteractResolve } from './propInteractSync';

/** cos(~55°) — look cone toward the prop center. */
const FP_PROP_FACE_DOT_MIN = 0.55;

export type FpInteractTarget = ImageItem | MapItem;

function newRequestId(): string {
  return `pi-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export function modularInteractLabel(item: MapItem): string {
  const title = pieceForUrl(item.modelUrl)?.title?.trim();
  if (title) return title;
  return item.modularOpen ? 'Close door' : 'Open door';
}

function toggleModularGate(map: MapItem): void {
  const patch = {
    modularOpen: !map.modularOpen,
    modularOpenAt: Date.now(),
  };
  useItemStore.getState().updateItem(map.id, patch);
  emitItemUpdate([{ id: map.id, patch }]);
}

/** True when FP look is aimed at the prop (or standing on it). */
export function isFacingProp(token: TokenItem, prop: FpInteractTarget): boolean {
  const tc = itemCenter(token);
  const pc = itemCenter(prop);
  let dx = pc.cx - tc.cx;
  let dy = pc.cy - tc.cy;
  const len = Math.hypot(dx, dy);
  if (len < 8) return true;
  dx /= len;
  dy /= len;
  const { x: fx, y: fy } = yawForwardWorld(firstPersonLook.yaw);
  return fx * dx + fy * dy >= FP_PROP_FACE_DOT_MIN;
}

/**
 * Nearest visible triggerable prop within 10 ft that you are facing.
 * Hidden props never count — even for the GM.
 */
export function fpInteractPropForToken(token: TokenItem, _gm = false): FpInteractTarget | null {
  void _gm;
  const items = Object.values(useItemStore.getState().items);
  let best: FpInteractTarget | null = null;
  let bestDist = Infinity;
  for (const item of items) {
    if (item.visible === false) continue;
    let usable = false;
    if (item.type === 'image') {
      const id = resolvePropId(item);
      usable = Boolean(id && canTriggerProp(id));
    } else if (item.type === 'map') {
      usable = isModularGate(item);
    }
    if (!usable || (item.type !== 'image' && item.type !== 'map')) continue;
    const d = distanceTokenToPropFeet(token, item);
    if (d > FP_PROP_INTERACT_RANGE_FT) continue;
    if (!isFacingProp(token, item)) continue;
    if (d < bestDist) {
      best = item;
      bestDist = d;
    }
  }
  return best;
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
  if (actor?.type !== 'token') return;
  if (prop?.type === 'map' && isModularGate(prop)) {
    if (action === 'deny') return;
    toggleModularGate(prop);
    return;
  }
  if (prop?.type !== 'image') return;

  switch (action) {
    case 'deny':
      return;
    case 'use':
      // Stats already credited in ingestPropInteractResolve — don't double-count.
      await triggerDungeonPropAsync(prop, { actor, skipRoll: true, skipStat: true });
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
  const playerWaiting = store.playerWaiting?.requestId === requestId ? store.playerWaiting : null;
  const tracked = gmPending ?? playerWaiting;

  if (store.playerWaiting?.requestId === requestId) {
    store.clearPlayerWaiting(requestId);
  }
  if (gmPending) store.clearGmRequest(requestId);

  // Credit the requesting / assigned player — never the DM account.
  if (action !== 'deny' && tracked) {
    const forUser =
      playerStatTarget(resolveStatUserRef(tracked.requesterUserId, tracked.requesterName));
    if (forUser) {
      recordObjectInteract({
        propItemId: tracked.propItemId,
        propName: tracked.propName,
        action: action === 'use' ? 'dm-approved' : `dm-approved-${action}`,
        at: Date.now(),
        forUser,
        eventId: `obj:${tracked.requestId}:${action}`,
      });
    }
  }

  if (action === 'deny' || !gmPending) return;
  void executePropInteractAction(gmPending.propItemId, gmPending.actorTokenId, action);
}

export function propInteractCheckHint(item: FpInteractTarget): string | null {
  if (item.type !== 'image') return null;
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

/** Spawn default / missing flag → DM must approve. Explicit `false` skips the gate. */
export function propRequiresDmApprove(item: FpInteractTarget): boolean {
  return item.propNeedsDmApprove !== false;
}

/**
 * Shared use path for FP (E) and 2D click — DM approve when required, else free use.
 */
export function requestOrUsePropInteract(prop: FpInteractTarget, actor: TokenItem): boolean {
  const gm = useSessionStore.getState().myRole === 'GM';
  if (prop.visible === false && !gm) return false;
  if (!canUsePropUnderToken(actor)) return false;

  if (!propRequiresDmApprove(prop)) {
    if (prop.type === 'map' && isModularGate(prop)) {
      toggleModularGate(prop);
      return true;
    }
    if (prop.type === 'image') void triggerDungeonPropAsync(prop, { actor });
    return true;
  }

  const requestId = newRequestId();
  const myUserId = useSessionStore.getState().myUserId ?? 'local';
  // Prefer token assignee so DM approve credits Michael, not Idle G (DM).
  const assigned = resolveTokenStatUser(actor.ownerId, actor.name);
  const requesterUserId = assigned?.userId ?? myUserId;
  const requesterName = assigned?.userName || actor.name?.trim() || 'Player';
  const payload = {
    requestId,
    propItemId: prop.id,
    actorTokenId: actor.id,
    requesterUserId,
    requesterName,
    propName: prop.type === 'map' ? modularInteractLabel(prop) : prop.name,
    at: Date.now(),
  };

  if (gm) {
    openGmPropInteractPrompt(payload);
    return true;
  }

  const sessionId = useSessionStore.getState().sessionId;
  if (!sessionId) return false;
  usePropInteractRequestStore.getState().setPlayerWaiting(payload);
  emitPropInteractRequest(sessionId, payload);
  return true;
}

/** Press E in first person — request DM approval or open GM prompt. */
export function tryFirstPersonPropInteract(): boolean {
  if (!useFirstPersonStore.getState().enabled) return false;
  const token = resolveFirstPersonToken();
  if (!token || !canUsePropUnderToken(token)) return false;

  const gm = useSessionStore.getState().myRole === 'GM';
  const prop = fpInteractPropForToken(token, gm);
  if (!prop) return false;
  return requestOrUsePropInteract(prop, token);
}

/** Nearest token this user may operate that is in range of the prop. */
function mapPropActor(prop: FpInteractTarget): TokenItem | null {
  const preferred = resolveFirstPersonToken();
  if (preferred && canUsePropUnderToken(preferred) && distanceTokenToPropFeet(preferred, prop) <= FP_PROP_INTERACT_RANGE_FT) {
    return preferred;
  }

  const selected = useItemStore.getState().selectedIds
    .map((id) => useItemStore.getState().items[id])
    .filter((i): i is TokenItem => i?.type === 'token' && canUsePropUnderToken(i));
  for (const t of selected) {
    if (distanceTokenToPropFeet(t, prop) <= FP_PROP_INTERACT_RANGE_FT) return t;
  }

  // Only consider tokens the local user can use (not a nearby monster).
  const usable = Object.values(useItemStore.getState().items).filter(
    (i): i is TokenItem => i.type === 'token' && canUsePropUnderToken(i),
  );
  let best: TokenItem | null = null;
  let bestDist = Infinity;
  for (const token of usable) {
    const d = distanceTokenToPropFeet(token, prop);
    if (d > FP_PROP_INTERACT_RANGE_FT) continue;
    if (d < bestDist) {
      best = token;
      bestDist = d;
    }
  }
  if (best) return best;

  // Fallback: nearest owned token even if out of range (request still fires; DM sees who).
  if (preferred && canUsePropUnderToken(preferred)) return preferred;
  if (selected[0]) return selected[0];
  let anyBest: TokenItem | null = null;
  let anyDist = Infinity;
  for (const token of usable) {
    const d = distanceTokenToPropFeet(token, prop);
    if (d < anyDist) {
      anyBest = token;
      anyDist = d;
    }
  }
  return anyBest;
}

/**
 * 2D map click on a door/chest — player or GM; uses nearest owned token in range.
 */
export function tryMapPropInteract(prop: FpInteractTarget): boolean {
  const gm = useSessionStore.getState().myRole === 'GM';
  if (prop.visible === false && !gm) return false;
  if (prop.type === 'map') {
    if (!isModularGate(prop)) return false;
  } else {
    const id = resolvePropId(prop);
    if (!id || !canTriggerProp(id)) return false;
  }

  const actor = mapPropActor(prop);
  if (!actor) return false;
  if (!canUsePropUnderToken(actor)) return false;
  return requestOrUsePropInteract(prop, actor);
}
