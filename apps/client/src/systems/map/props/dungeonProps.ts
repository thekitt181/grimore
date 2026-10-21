import { v4 as uuidv4 } from 'uuid';
import { getActiveMap, useItemStore } from '@/systems/scene/store/itemStore';
import { emitItemAdd, emitItemUpdate } from '@/systems/scene/sceneSync';
import { pointInItem } from '@/systems/scene/hitTest';
import type { ImageItem, MapItem, TokenItem } from '@/systems/scene/types';
import { itemCenter } from '@/systems/scene/types';
import { PROP_ART, propArtById, type PropMotion } from './propArt';
import { isDoorPropId } from './doorCollision';
import { fitDoorOrGateOnMap } from './doorFit';
import type { DdbRollBridgePayload, GrimoireCharacter } from '@grimoire/shared';
import { useDiceStore } from '@/systems/dice/diceStore';
import { useSessionStore } from '@/store/sessionStore';
import { playerOwnsToken, isPlayerCharacterToken } from '@/systems/scene/token/clientTokenVisibility';
import { itemDisplayZIndex } from '@/systems/scene/zOrder';
import { queryClient } from '@/lib/queryClient';
import { syncDdbCharacter } from '@/systems/ddb/ddbApi';
import { getMapGridSize } from '@/systems/combat/attackRange';
import {
  formatModNotation,
  propActivateCheckDef,
  resolveCheckMod,
  guessCheckIdFromRollLabel,
  rollLabelMatchesCheck,
} from './propActivateChecks';
import { usePropDdbArmStore, type PropCheckKind, type PropDdbArm } from './propDdbArmStore';

/** Max distance to use / open a prop from a token (5e interact range). */
export const PROP_USE_RANGE_FT = 15;

export interface DungeonProp {
  id: string;
  name: string;
  short: string;
  imageUrl: string;
}

export type { PropMotion };

const LEGACY_NAMES: Record<string, string> = {
  Chest: 'chest',
  'Locked chest': 'sarcophagus',
  Coins: 'coins',
  Bones: 'skeleton',
  Skull: 'skull',
  Corpse: 'corpse',
  'Spike trap': 'spear',
  'Bear trap': 'blade',
  'Pressure plate': 'plate',
  Barrel: 'crate',
  Crate: 'crate',
  Rubble: 'boulder',
  Pillar: 'column',
  Altar: 'altar',
  Statue: 'statue',
  Torch: 'torch',
  Campfire: 'campfire',
  'Trap door': 'hatch',
  'Arrow trap': 'arrows',
  Portcullis: 'gate',
};

const DEFAULT_ACTIVATE_NOTATION = '1d20';

/** How a prop behaves when someone uses it on the map. */
export function propMotion(id: string): PropMotion {
  return propArtById(id)?.motion ?? 'none';
}

export function canTriggerProp(id: string): boolean {
  const motion = propMotion(id);
  return motion === 'toggle' || motion === 'fire';
}

export function resolvePropId(item: ImageItem): string | undefined {
  if (item.propId) return item.propId;
  if (item.imageUrl.startsWith('/props/')) {
    return DUNGEON_PROPS.find((prop) => prop.imageUrl === item.imageUrl)?.id;
  }
  if (item.imageUrl.startsWith('data:image/svg')) {
    return DUNGEON_PROPS.find((prop) => prop.name === item.name)?.id ?? LEGACY_NAMES[item.name];
  }
  return undefined;
}

export const DUNGEON_PROPS: DungeonProp[] = PROP_ART.map((art) => ({
  id: art.id,
  name: art.name,
  short: art.short,
  imageUrl: art.rest,
}));

function cellCenter(map: MapItem, col: number, row: number): { x: number; y: number } {
  const g = map.gridSize;
  return {
    x: map.x + map.gridOffsetX + (col + 0.5) * g,
    y: map.y + map.gridOffsetY + (row + 0.5) * g,
  };
}

/** Drop a prop on the active map, near the middle, nudged so repeats do not stack. */
export function placeDungeonProp(prop: DungeonProp, hidden: boolean): void {
  const map = getActiveMap();
  if (!map) {
    window.alert('Select a map first.');
    return;
  }

  const same = Object.values(useItemStore.getState().items).filter(
    (item) => item.type === 'image' && item.name === prop.name,
  ).length;
  const cols = Math.max(1, Math.floor(map.width / map.gridSize));
  const rows = Math.max(1, Math.floor(map.height / map.gridSize));
  const col = Math.min(cols - 1, Math.max(0, Math.floor(cols / 2) - 2 + (same % 5)));
  const row = Math.min(rows - 1, Math.max(0, Math.floor(rows / 2) + Math.floor(same / 5)));
  const center = cellCenter(map, col, row);
  const size = map.gridSize;

  let x = center.x - size / 2;
  let y = center.y - size / 2;
  let width = size;
  let height = size;
  let rotation = 0;

  // Doors / gates snap into the nearest wall opening (or onto a short wall run).
  if (isDoorPropId(prop.id)) {
    const fit = fitDoorOrGateOnMap(map, center.x, center.y, prop.id);
    if (fit) {
      x = fit.x;
      y = fit.y;
      width = fit.width;
      height = fit.height;
      rotation = fit.rotation;
    }
  }

  const image: ImageItem = {
    id: uuidv4(),
    type: 'image',
    name: prop.name,
    imageUrl: prop.imageUrl,
    propId: prop.id,
    propState: 0,
    x,
    y,
    rotation,
    width,
    height,
    zIndex: 1,
    locked: false,
    visible: !hidden,
  };

  const store = useItemStore.getState();
  store.addItem(image);
  emitItemAdd(image);
  store.select([image.id], 'set');
}

function positiveDc(n: number | undefined): number {
  return typeof n === 'number' && n > 0 ? Math.floor(n) : 0;
}

function activateDc(item: ImageItem): number {
  return positiveDc(item.propActivateDc);
}

function revealDc(item: ImageItem): number {
  return positiveDc(item.propRevealDc);
}

function cachedDdbCharacter(ddbCharacterId: number | undefined): GrimoireCharacter | undefined {
  if (!ddbCharacterId) return undefined;
  return queryClient.getQueryData<GrimoireCharacter>(['ddb', 'character', ddbCharacterId]);
}

/** Ensure DDB character sheet (skills/abilities) is in the react-query cache. */
async function ensureDdbCharacter(ddbCharacterId: number | undefined): Promise<GrimoireCharacter | undefined> {
  if (!ddbCharacterId) return undefined;
  const cached = cachedDdbCharacter(ddbCharacterId);
  if (cached) return cached;
  try {
    const ch = await syncDdbCharacter(ddbCharacterId);
    queryClient.setQueryData(['ddb', 'character', ddbCharacterId], ch);
    return ch;
  } catch {
    return undefined;
  }
}

/** Edge-to-edge distance from token to prop in feet. */
export function distanceTokenToPropFeet(
  token: TokenItem,
  prop: ImageItem,
  gridSize = getMapGridSize(),
): number {
  const tc = itemCenter(token);
  const pc = itemCenter(prop);
  const distPx = Math.hypot(pc.cx - tc.cx, pc.cy - tc.cy);
  const centerFeet = (distPx / Math.max(1, gridSize)) * 5;
  const tokenR = (Math.min(token.width, token.height) / 2 / Math.max(1, gridSize)) * 5;
  const propR = (Math.min(prop.width, prop.height) / 2 / Math.max(1, gridSize)) * 5;
  return Math.max(0, Math.round(centerFeet - tokenR - propR));
}

export function isTokenInPropRange(
  token: TokenItem,
  prop: ImageItem,
  rangeFt = PROP_USE_RANGE_FT,
): boolean {
  return distanceTokenToPropFeet(token, prop) <= rangeFt;
}

/** Nearest token within range of the prop (prefers covering / selected). */
export function tokenNearProp(
  prop: ImageItem,
  preferred?: TokenItem | null,
  rangeFt = PROP_USE_RANGE_FT,
): TokenItem | null {
  if (preferred && isTokenInPropRange(preferred, prop, rangeFt)) return preferred;

  const tokens = Object.values(useItemStore.getState().items).filter(
    (i): i is TokenItem => i.type === 'token',
  );
  let best: TokenItem | null = null;
  let bestDist = Infinity;
  for (const token of tokens) {
    const d = distanceTokenToPropFeet(token, prop);
    if (d > rangeFt) continue;
    if (d < bestDist) {
      best = token;
      bestDist = d;
    }
  }
  return best;
}

/** Token whose center lies on the prop (player standing on chest / door). */
export function tokenCoveringProp(prop: ImageItem): TokenItem | null {
  const cx = prop.x + prop.width / 2;
  const cy = prop.y + prop.height / 2;
  const tokens = Object.values(useItemStore.getState().items)
    .filter((i): i is TokenItem => i.type === 'token')
    .sort((a, b) => itemDisplayZIndex(b) - itemDisplayZIndex(a));
  for (const token of tokens) {
    if (pointInItem(token, cx, cy)) return token;
  }
  return tokenNearProp(prop);
}

export function propActivateCheckLabel(item: ImageItem): string | undefined {
  return propActivateCheckDef(item.propActivateCheck)?.label;
}

export function propRevealCheckLabel(item: ImageItem): string | undefined {
  return propActivateCheckDef(item.propRevealCheck)?.label;
}

/** Hidden + reveal DC set → next Use searches / reveals (does not open). */
export function propNeedsRevealRoll(item: ImageItem): boolean {
  return item.visible === false && revealDc(item) > 0;
}

/** True when opening this prop requires an activate roll (not reveal). */
export function propTriggerNeedsRoll(item: ImageItem): boolean {
  const id = resolvePropId(item);
  if (!id || !canTriggerProp(id) || activateDc(item) <= 0) return false;
  // Must be revealed first when a reveal check is configured.
  if (propNeedsRevealRoll(item)) return false;
  const motion = propMotion(id);
  if (motion === 'fire') return true;
  return (item.propState ?? 0) <= 0;
}

/** Next dice step for this prop, if any. */
export function propNextCheckKind(item: ImageItem): PropCheckKind | null {
  if (propNeedsRevealRoll(item)) return 'reveal';
  if (propTriggerNeedsRoll(item)) return 'activate';
  return null;
}

function resolvePropCheckRoll(
  item: ImageItem,
  kind: PropCheckKind,
  actor: TokenItem | null | undefined,
): { notation: string; label: string; checkLabel?: string; dc: number; checkId?: string } {
  const dc = kind === 'reveal' ? revealDc(item) : activateDc(item);
  const checkId = (kind === 'reveal' ? item.propRevealCheck : item.propActivateCheck)?.trim();
  const custom = (kind === 'reveal' ? item.propRevealNotation : item.propActivateNotation)?.trim();
  const def = propActivateCheckDef(checkId);
  const checkLabel = def?.label;
  const character = actor ? cachedDdbCharacter(actor.ddbCharacterId) : undefined;

  let notation = DEFAULT_ACTIVATE_NOTATION;
  if (def && character) {
    const resolved = resolveCheckMod(character, def.id);
    if (resolved) notation = formatModNotation(resolved.mod);
    else if (custom) notation = custom;
  } else if (custom) {
    notation = custom;
  }

  const who = actor?.name?.trim() || character?.name;
  const verb = kind === 'reveal' ? 'reveal' : 'open';
  const parts = [
    who,
    checkLabel ? `${checkLabel} check` : null,
    `${item.name} ${verb} (DC ${dc})`,
  ].filter(Boolean);
  const label = parts.join(' · ');
  const out: { notation: string; label: string; checkLabel?: string; dc: number; checkId?: string } = {
    notation,
    label,
    dc,
  };
  if (checkLabel) out.checkLabel = checkLabel;
  if (checkId) out.checkId = checkId;
  return out;
}

/** @deprecated use resolvePropCheckRoll(item, 'activate', actor) */
export function resolveActivateRoll(
  item: ImageItem,
  actor: TokenItem | null | undefined,
): { notation: string; label: string; checkLabel?: string } {
  const r = resolvePropCheckRoll(item, 'activate', actor);
  return r.checkLabel ? { notation: r.notation, label: r.label, checkLabel: r.checkLabel } : { notation: r.notation, label: r.label };
}

function applyReveal(item: ImageItem): void {
  if (item.visible !== false) return;
  const patch: Partial<ImageItem> = { visible: true };
  useItemStore.getState().updateItem(item.id, patch);
  emitItemUpdate([{ id: item.id, patch }]);
}

function applyPropTrigger(item: ImageItem, id: string, mode: 'toggle' | 'open' = 'toggle'): void {
  const motion = propMotion(id);
  let propState: number;
  if (motion === 'fire') {
    propState = (item.propState ?? 0) + 1;
  } else if (mode === 'open') {
    propState = 1;
  } else {
    propState = (item.propState ?? 0) > 0 ? 0 : 1;
  }
  const patch: Partial<ImageItem> = {
    propId: id,
    propState,
    propAt: Date.now(),
  };
  // Opening also reveals when there is no separate reveal check.
  if (item.visible === false && revealDc(item) <= 0) {
    patch.visible = true;
  }
  useItemStore.getState().updateItem(item.id, patch);
  emitItemUpdate([{ id: item.id, patch }]);
}

/** Apply a successful reveal or activate check from VTT / D&D Beyond. */
export function applyArmedPropResult(
  item: ImageItem,
  success: boolean,
  kind: PropCheckKind = 'activate',
): void {
  if (!success) return;
  if (kind === 'reveal') {
    applyReveal(item);
    return;
  }
  const id = resolvePropId(item);
  if (!id || !canTriggerProp(id)) return;
  applyPropTrigger(item, id, 'open');
}

export type TriggerPropResult = 'ok' | 'fail' | 'noop' | 'armed';

export function armPropForDdbRoll(
  item: ImageItem,
  actor?: TokenItem | null,
  kind?: PropCheckKind,
): boolean {
  const resolvedKind = kind ?? propNextCheckKind(item);
  if (!resolvedKind) return false;

  const checkId = (
    resolvedKind === 'reveal' ? item.propRevealCheck : item.propActivateCheck
  )?.trim();
  if (!checkId || !propActivateCheckDef(checkId)) return false;
  const dc = resolvedKind === 'reveal' ? revealDc(item) : activateDc(item);
  if (dc <= 0) return false;

  const token = tokenNearProp(item, actor ?? null);
  if (!token) return false;

  const character = cachedDdbCharacter(token.ddbCharacterId);
  const arm: PropDdbArm = {
    propId: item.id,
    propName: item.name,
    checkId,
    dc,
    kind: resolvedKind,
    armedAt: Date.now(),
  };
  if (token.ddbCharacterId != null) arm.ddbCharacterId = token.ddbCharacterId;
  const name = token.name?.trim() || character?.name;
  if (name) arm.characterName = name;

  usePropDdbArmStore.getState().arm(arm);
  return true;
}

function namesMatchLoose(a: string, b: string): boolean {
  const na = a.toLowerCase().trim();
  const nb = b.toLowerCase().trim();
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

/** Tokens that could have made this roll (DDB id or character name). */
function tokensForRoller(opts: {
  ddbCharacterId?: number;
  characterName?: string;
}): TokenItem[] {
  const all = Object.values(useItemStore.getState().items).filter(
    (i): i is TokenItem => i.type === 'token',
  );
  const byId =
    opts.ddbCharacterId != null
      ? all.filter((t) => t.ddbCharacterId === opts.ddbCharacterId)
      : [];
  if (byId.length) return byId;
  if (opts.characterName) {
    const byName = all.filter((t) => namesMatchLoose(t.name, opts.characterName!));
    if (byName.length) return byName;
  }
  return [];
}

function propsNeedingCheckNearTokens(
  checkId: string,
  tokens: TokenItem[],
  rangeFt = PROP_USE_RANGE_FT,
): Array<{ prop: ImageItem; token: TokenItem; dist: number; kind: PropCheckKind }> {
  const images = Object.values(useItemStore.getState().items).filter(
    (i): i is ImageItem => i.type === 'image',
  );
  const out: Array<{ prop: ImageItem; token: TokenItem; dist: number; kind: PropCheckKind }> = [];
  for (const prop of images) {
    for (const token of tokens) {
      const dist = distanceTokenToPropFeet(token, prop);
      if (dist > rangeFt) continue;
      // Prefer reveal when still hidden — Perception shouldn't also yank the gate open.
      if (propNeedsRevealRoll(prop) && (prop.propRevealCheck ?? '').trim() === checkId) {
        out.push({ prop, token, dist, kind: 'reveal' });
        continue;
      }
      if (propTriggerNeedsRoll(prop) && (prop.propActivateCheck ?? '').trim() === checkId) {
        out.push({ prop, token, dist, kind: 'activate' });
      }
    }
  }
  out.sort((a, b) => a.dist - b.dist);
  return out;
}

export interface PropCheckRollIngest {
  label: string;
  notation?: string;
  total: number;
  isDamage?: boolean;
  ddbCharacterId?: number;
  characterName?: string;
  /** Preferred map token for range checks (character sheet rolls). */
  actorTokenId?: string;
}

/**
 * Apply a skill/ability roll (VTT or D&D Beyond) to the nearest matching prop
 * within 15 ft of the roller. Armed props are preferred.
 */
export function tryConsumePropCheckRoll(roll: PropCheckRollIngest): boolean {
  if (roll.isDamage) return false;

  const pending = usePropDdbArmStore.getState().getFreshPending();
  const guessed = guessCheckIdFromRollLabel(roll.label, roll.notation);
  const matchesPending =
    pending != null && rollLabelMatchesCheck(roll.label, roll.notation, pending.checkId);
  const checkId = guessed ?? (matchesPending ? pending!.checkId : undefined);
  if (!checkId) return false;

  const rollerOpts: { ddbCharacterId?: number; characterName?: string } = {};
  if (roll.ddbCharacterId != null) rollerOpts.ddbCharacterId = roll.ddbCharacterId;
  if (roll.characterName && roll.characterName.toLowerCase() !== 'you') {
    rollerOpts.characterName = roll.characterName;
  }

  function resolveRollers(): TokenItem[] {
    const store = useItemStore.getState();
    if (roll.actorTokenId) {
      const t = store.items[roll.actorTokenId];
      if (t?.type === 'token') return [t];
    }
    let rollers = tokensForRoller(rollerOpts);
    if (rollers.length) return rollers;

    rollers = store.selectedIds
      .map((id) => store.items[id])
      .filter((i): i is TokenItem => i?.type === 'token');
    if (rollers.length) return rollers;

    const { myRole, myUserId } = useSessionStore.getState();
    rollers = Object.values(store.items).filter(
      (i): i is TokenItem =>
        i.type === 'token' && (playerOwnsToken(i, myUserId) || isPlayerCharacterToken(i)),
    );
    if (rollers.length) return rollers;

    // Last resort (GM sheet rolls, etc.): any token — still limited by 15 ft to the prop.
    return Object.values(store.items).filter((i): i is TokenItem => i.type === 'token');
  }

  const rollers = resolveRollers();

  // Armed prop: matching check + a roller within 15 ft.
  if (pending && (pending.checkId === checkId || rollLabelMatchesCheck(roll.label, roll.notation, pending.checkId))) {
    const item = useItemStore.getState().items[pending.propId];
    const stillNeeded =
      item?.type === 'image'
      && (pending.kind === 'reveal' ? propNeedsRevealRoll(item) : propTriggerNeedsRoll(item));
    if (item?.type === 'image' && stillNeeded) {
      const nearRoller = rollers.find((t) => isTokenInPropRange(t, item));
      if (nearRoller || tokenNearProp(item)) {
        applyArmedPropResult(item, roll.total >= pending.dc, pending.kind);
        usePropDdbArmStore.getState().clear();
        return true;
      }
    }
  }

  if (rollers.length === 0) return false;

  const candidates = propsNeedingCheckNearTokens(checkId, rollers);
  const hit = candidates[0];
  if (!hit) return false;

  const dc = hit.kind === 'reveal' ? revealDc(hit.prop) : activateDc(hit.prop);
  applyArmedPropResult(hit.prop, roll.total >= dc, hit.kind);
  if (pending?.propId === hit.prop.id) usePropDdbArmStore.getState().clear();
  return true;
}

/**
 * When a D&D Beyond skill/ability roll arrives, complete an armed or nearby prop check.
 */
export function tryConsumePropDdbRoll(payload: DdbRollBridgePayload): boolean {
  const ingest: PropCheckRollIngest = {
    label: payload.label,
    total: payload.total,
    isDamage: payload.isDamage,
  };
  if (payload.notation) ingest.notation = payload.notation;
  if (payload.ddbCharacterId != null) ingest.ddbCharacterId = payload.ddbCharacterId;
  if (payload.characterName) ingest.characterName = payload.characterName;
  return tryConsumePropCheckRoll(ingest);
}

/**
 * Play a chest, hatch, door, or trap on the map.
 * Hidden props with a reveal DC → search roll first (shows to players, does not open).
 * Visible props with an activate DC → open roll.
 * Pass `waitForDdb: true` to arm for a matching D&D Beyond roll instead of rolling in VTT.
 */
export function triggerDungeonProp(
  item: ImageItem,
  opts?: { skipRoll?: boolean; actor?: TokenItem | null; waitForDdb?: boolean },
): TriggerPropResult {
  const id = resolvePropId(item);
  if (!id || !canTriggerProp(id)) return 'noop';

  const preferred = opts?.actor !== undefined ? opts.actor : null;
  const actor = tokenNearProp(item, preferred);
  if (!opts?.skipRoll && !actor) return 'noop';

  const nextKind = !opts?.skipRoll ? propNextCheckKind(item) : null;
  if (nextKind) {
    if (opts?.waitForDdb) {
      if (!armPropForDdbRoll(item, actor, nextKind)) return 'noop';
      return 'armed';
    }

    const resolved = resolvePropCheckRoll(item, nextKind, actor);
    lastPropUseRollAt = Date.now();
    const entry = useDiceStore.getState().performRoll(resolved.notation, resolved.label);
    if (!entry) return 'noop';
    if (entry.total < resolved.dc) return 'fail';
    applyArmedPropResult(item, true, nextKind);
    return 'ok';
  }

  // Hidden with no reveal DC: free reveal when used (then stop so activate is a second Use).
  if (item.visible === false && revealDc(item) <= 0 && activateDc(item) > 0) {
    applyReveal(item);
    return 'ok';
  }
  if (item.visible === false && revealDc(item) <= 0 && activateDc(item) <= 0) {
    applyPropTrigger(item, id, 'toggle');
    return 'ok';
  }

  applyPropTrigger(item, id, 'toggle');
  return 'ok';
}

/** Ignore VTT tray re-ingest for rolls that already opened a prop via Use. */
let lastPropUseRollAt = 0;
export function wasRecentPropUseRoll(withinMs = 2500): boolean {
  return Date.now() - lastPropUseRollAt < withinMs;
}

/**
 * Same as triggerDungeonProp, but syncs the covering token’s D&D Beyond sheet first
 * so Perception / Investigation / etc. use the real modifier in the VTT roll.
 */
export async function triggerDungeonPropAsync(
  item: ImageItem,
  opts?: { skipRoll?: boolean; actor?: TokenItem | null; waitForDdb?: boolean },
): Promise<TriggerPropResult> {
  const actor = tokenNearProp(item, opts?.actor !== undefined ? opts.actor : null);
  if (!opts?.skipRoll && !actor) return 'noop';
  const next = propNextCheckKind(item);
  const checkLinked =
    next === 'reveal' ? item.propRevealCheck : next === 'activate' ? item.propActivateCheck : undefined;
  if (!opts?.skipRoll && !opts?.waitForDdb && next && checkLinked) {
    await ensureDdbCharacter(actor?.ddbCharacterId);
  }
  return triggerDungeonProp(item, { ...opts, actor });
}

/** Topmost triggerable image under a world point, ignoring tokens/drawings on top. */
export function triggerablePropAt(wx: number, wy: number, gm: boolean): ImageItem | null {
  const items = Object.values(useItemStore.getState().items)
    .filter((item): item is ImageItem => {
      if (item.type !== 'image') return false;
      if (!gm && item.visible === false) return false;
      return true;
    })
    .sort((a, b) => itemDisplayZIndex(b) - itemDisplayZIndex(a));

  for (const item of items) {
    if (!pointInItem(item, wx, wy)) continue;
    const id = resolvePropId(item);
    if (!id || !canTriggerProp(id)) continue;
    return item;
  }
  return null;
}

/**
 * Nearest triggerable prop within 15 ft of a token (gates in walls count when you stand next to them).
 * Players may also find DM-hidden props here so they can search / roll to reveal.
 */
export function triggerablePropUnderToken(token: TokenItem, gm: boolean): ImageItem | null {
  const items = Object.values(useItemStore.getState().items)
    .filter((item): item is ImageItem => {
      if (item.type !== 'image') return false;
      if (!gm && item.visible === false) {
        const id = resolvePropId(item);
        return Boolean(id && canTriggerProp(id));
      }
      return true;
    });

  let best: ImageItem | null = null;
  let bestDist = Infinity;
  const cx = token.x + token.width / 2;
  const cy = token.y + token.height / 2;

  for (const item of items) {
    const id = resolvePropId(item);
    if (!id || !canTriggerProp(id)) continue;
    // Prefer props the token is literally on; otherwise anything within interact range.
    if (pointInItem(item, cx, cy)) {
      const d = distanceTokenToPropFeet(token, item);
      if (d < bestDist) {
        best = item;
        bestDist = d;
      }
      continue;
    }
    const d = distanceTokenToPropFeet(token, item);
    if (d > PROP_USE_RANGE_FT) continue;
    if (d < bestDist) {
      best = item;
      bestDist = d;
    }
  }
  return best;
}

/** Whether the current user may use / search a prop under this token. */
export function canUsePropUnderToken(token: TokenItem): boolean {
  const { myRole, myUserId } = useSessionStore.getState();
  if (myRole === 'GM') return true;
  return playerOwnsToken(token, myUserId) || isPlayerCharacterToken(token);
}

/**
 * Use the prop under a token (easy path when a token covers the prop).
 * Returns null when nothing usable is there.
 */
export async function triggerPropUnderToken(
  token: TokenItem,
  opts?: { waitForDdb?: boolean },
): Promise<TriggerPropResult | null> {
  if (!canUsePropUnderToken(token)) return null;
  const gm = useSessionStore.getState().myRole === 'GM';
  const prop = triggerablePropUnderToken(token, gm);
  if (!prop) return null;
  if (opts?.waitForDdb) {
    return triggerDungeonProp(prop, { actor: token, waitForDdb: true });
  }
  return triggerDungeonPropAsync(prop, { actor: token });
}

/** Prefer selected prop, else prop under selected token. */
export function triggerSelectedOrUnderToken(): TriggerPropResult | null {
  const store = useItemStore.getState();
  const gm = useSessionStore.getState().myRole === 'GM';
  const selected = store.selectedIds
    .map((id) => store.items[id])
    .filter((item): item is NonNullable<typeof item> => item != null);

  for (const item of selected) {
    if (item.type === 'image') {
      const id = resolvePropId(item);
      if (id && canTriggerProp(id)) {
        if (!gm && item.visible === false) continue;
        const actor = tokenNearProp(item);
        if (!actor) return 'noop';
        void triggerDungeonPropAsync(item, { actor });
        return 'ok';
      }
    }
  }

  for (const item of selected) {
    if (item.type === 'token' && canUsePropUnderToken(item)) {
      const prop = triggerablePropUnderToken(item, gm);
      if (prop) {
        void triggerDungeonPropAsync(prop, { actor: item });
        return 'ok';
      }
    }
  }

  return null;
}
