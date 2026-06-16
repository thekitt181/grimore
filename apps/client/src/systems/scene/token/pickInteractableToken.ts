import { pickSceneItem } from '@/systems/scene/sceneRefs';
import { pointInItem } from '@/systems/scene/hitTest';
import { itemDisplayZIndex } from '@/systems/scene/zOrder';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { useLiveTransformStore } from '@/systems/scene/store/liveTransformStore';
import type { LiveTransform } from '@/systems/scene/store/liveTransformStore';
import { useMapStore } from '@/systems/map/store/mapStore';
import { useSessionStore } from '@/store/sessionStore';
import { clientToWorld } from '@/systems/scene/sceneRefs';
import { resolveItemBounds } from '@/systems/map3d/sceneItemBounds';
import { getPickCanvasRect } from '@/systems/map3d/pickCamera';
import { sceneCameraRef } from '@/systems/map3d/sceneCameraRef';
import { worldXZToClientScreen } from '@/systems/map3d/perspectiveCameraSync';
import { playerInteractableTokens } from './clientTokenVisibility';
import type { TokenItem } from '../types';

/** Visible tokens valid as spell/attack targets (includes locked NPCs). */
export function allTargetableTokens(): TokenItem[] {
  const items = useItemStore.getState().items;
  return Object.values(items).filter(
    (i): i is TokenItem => i.type === 'token' && i.visible !== false,
  );
}

/** Unlocked visible tokens the current client may drag (GM: all; players: same rules). */
export function allInteractableTokens(): TokenItem[] {
  const items = useItemStore.getState().items;
  if (useSessionStore.getState().myRole === 'GM') {
    return Object.values(items).filter(
      (i): i is TokenItem => i.type === 'token' && i.visible !== false && !i.locked,
    );
  }
  return playerInteractableTokens(items);
}

function sortTopmost(tokens: TokenItem[]): TokenItem[] {
  return [...tokens].sort((a, b) => itemDisplayZIndex(b) - itemDisplayZIndex(a));
}

interface ScreenRect {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  cx: number;
  cy: number;
  area: number;
}

function tokenScreenRect(
  token: TokenItem,
  live: LiveTransform | undefined,
  rect: DOMRect | null,
): ScreenRect | null {
  const b = resolveItemBounds(token, live);
  const viewMode = useMapStore.getState().viewMode;
  const viewport = useMapStore.getState().viewport;

  if (viewMode === '3d' && rect && sceneCameraRef.liveCamera) {
    const corners = [
      worldXZToClientScreen(b.x, b.y, rect),
      worldXZToClientScreen(b.x + b.width, b.y, rect),
      worldXZToClientScreen(b.x + b.width, b.y + b.height, rect),
      worldXZToClientScreen(b.x, b.y + b.height, rect),
    ];
    if (corners.some((c) => c == null)) return null;
    const xs = corners.map((c) => c!.x);
    const ys = corners.map((c) => c!.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const center = worldXZToClientScreen(b.cx, b.cz, rect);
    if (!center) return null;
    return {
      minX,
      maxX,
      minY,
      maxY,
      cx: center.x,
      cy: center.y,
      area: Math.max(1, (maxX - minX) * (maxY - minY)),
    };
  }

  const scale = Math.max(viewport.scale, 0.08);
  const canvas = rect ?? getPickCanvasRect();
  const offsetX = canvas?.left ?? 0;
  const offsetY = canvas?.top ?? 0;
  const minX = (b.x - viewport.x) * scale;
  const minY = (b.y - viewport.y) * scale;
  const maxX = minX + b.width * scale;
  const maxY = minY + b.height * scale;
  return {
    minX: minX + offsetX,
    maxX: maxX + offsetX,
    minY: minY + offsetY,
    maxY: maxY + offsetY,
    cx: (minX + maxX) * 0.5 + offsetX,
    cy: (minY + maxY) * 0.5 + offsetY,
    area: Math.max(1, (maxX - minX) * (maxY - minY)),
  };
}

type PickCandidate = { token: TokenItem; area: number; dist: number };

function rankCandidates(a: PickCandidate, b: PickCandidate): number {
  if (a.area !== b.area) return a.area - b.area;
  return a.dist - b.dist;
}

/**
 * Spell/attack targeting — prefer the smallest token under the cursor so large
 * bases do not steal clicks meant for nearby portrait minis (common in 3D).
 */
function pickSmallestTokenUnderPointer(
  clientX: number,
  clientY: number,
  tokens: TokenItem[],
): TokenItem | null {
  if (tokens.length === 0) return null;

  const rect = getPickCanvasRect();
  const liveById = useLiveTransformStore.getState().byId;
  const viewMode = useMapStore.getState().viewMode;
  const tightPad = viewMode === '3d' ? 8 : 4;
  const loosePad = viewMode === '3d' ? 18 : 10;

  const contained: PickCandidate[] = [];
  const nearby: PickCandidate[] = [];

  for (const token of tokens) {
    const screen = tokenScreenRect(token, liveById[token.id], rect);
    if (!screen) continue;

    const dist = Math.hypot(clientX - screen.cx, clientY - screen.cy);
    const inside =
      clientX >= screen.minX - tightPad
      && clientX <= screen.maxX + tightPad
      && clientY >= screen.minY - tightPad
      && clientY <= screen.maxY + tightPad;

    if (inside) {
      contained.push({ token, area: screen.area, dist });
      continue;
    }

    const reach = Math.max(screen.maxX - screen.minX, screen.maxY - screen.minY) * 0.5 + loosePad;
    if (dist <= reach) {
      nearby.push({ token, area: screen.area, dist });
    }
  }

  contained.sort(rankCandidates);
  if (contained.length > 0) return contained[0]!.token;

  nearby.sort(rankCandidates);
  if (nearby.length > 0) return nearby[0]!.token;

  const { x: wx, y: wy } = clientToWorld(clientX, clientY);
  let best: PickCandidate | null = null;
  const scale = Math.max(useMapStore.getState().viewport.scale, 0.08);
  for (const token of tokens) {
    const b = resolveItemBounds(token, liveById[token.id]);
    const dist = Math.hypot(wx - b.cx, wy - b.cz);
    const hitR = Math.min(b.width, b.height) * 0.5 + loosePad / scale;
    if (dist > hitR) continue;
    const candidate = { token, area: b.width * b.height, dist };
    if (!best || rankCandidates(candidate, best) < 0) best = candidate;
  }
  return best?.token ?? null;
}

function pickByWorldPoint(wx: number, wy: number, tokens: TokenItem[]): TokenItem | null {
  const liveById = useLiveTransformStore.getState().byId;
  const scale = Math.max(useMapStore.getState().viewport.scale, 0.08);
  const pad = Math.max(18, 24 / scale);

  for (const token of sortTopmost(tokens)) {
    const b = resolveItemBounds(token, liveById[token.id]);
    const probe = { ...token, x: b.x, y: b.y, width: b.width, height: b.height, rotation: b.rotation };
    if (pointInItem(probe, wx, wy)) return token;
  }

  let best: TokenItem | null = null;
  let bestDist = Infinity;
  for (const token of tokens) {
    const b = resolveItemBounds(token, liveById[token.id]);
    const dist = Math.hypot(wx - b.cx, wy - b.cz);
    const hitR = Math.max(b.width, b.height) * 0.62 + pad;
    if (dist <= hitR && dist < bestDist) {
      bestDist = dist;
      best = token;
    }
  }
  return best;
}

function pickByScreenBox(clientX: number, clientY: number, tokens: TokenItem[]): TokenItem | null {
  const rect = getPickCanvasRect();
  const liveById = useLiveTransformStore.getState().byId;
  const viewMode = useMapStore.getState().viewMode;
  const pad = viewMode === '3d' ? 40 : 20;

  let best: TokenItem | null = null;
  let bestDist = Infinity;
  const { x: wx, y: wy } = clientToWorld(clientX, clientY);
  const scale = scaleFromViewport();

  for (const token of sortTopmost(tokens)) {
    const b = resolveItemBounds(token, liveById[token.id]);

    if (viewMode === '3d' && rect && sceneCameraRef.liveCamera) {
      const corners = [
        worldXZToClientScreen(b.x, b.y, rect),
        worldXZToClientScreen(b.x + b.width, b.y, rect),
        worldXZToClientScreen(b.x + b.width, b.y + b.height, rect),
        worldXZToClientScreen(b.x, b.y + b.height, rect),
      ];
      if (corners.some((c) => c == null)) continue;
      const xs = corners.map((c) => c!.x);
      const ys = corners.map((c) => c!.y);
      const minX = Math.min(...xs) - pad;
      const maxX = Math.max(...xs) + pad;
      const minY = Math.min(...ys) - pad;
      const maxY = Math.max(...ys) + pad;
      if (clientX < minX || clientX > maxX || clientY < minY || clientY > maxY) continue;
      const center = worldXZToClientScreen(b.cx, b.cz, rect);
      if (!center) continue;
      const dist = Math.hypot(clientX - center.x, clientY - center.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = token;
      }
      continue;
    }

    const probe = { ...token, x: b.x, y: b.y, width: b.width, height: b.height, rotation: b.rotation };
    if (pointInItem(probe, wx, wy)) return token;
    const dist = Math.hypot(wx - b.cx, wy - b.cz);
    const hitR = Math.max(b.width, b.height) * 0.62 + pad / Math.max(scale, 0.08);
    if (dist <= hitR && dist < bestDist) {
      bestDist = dist;
      best = token;
    }
  }

  return best;
}

function scaleFromViewport(): number {
  return useMapStore.getState().viewport.scale;
}

/** Best-effort token under the pointer — raycast, screen bounds, then world fallback. */
function pickInteractableAt(clientX: number, clientY: number, tokens: TokenItem[]): TokenItem | null {
  if (tokens.length === 0) return null;

  const pickId = pickSceneItem(clientX, clientY);
  if (pickId) {
    const ray = useItemStore.getState().items[pickId];
    if (ray?.type === 'token' && ray.visible !== false && tokens.some((t) => t.id === ray.id)) {
      return ray as TokenItem;
    }
  }

  const screenHit = pickByScreenBox(clientX, clientY, tokens);
  if (screenHit) return screenHit;

  const { x: wx, y: wy } = clientToWorld(clientX, clientY);
  return pickByWorldPoint(wx, wy, tokens);
}

export function pickTargetTokenAt(
  clientX: number,
  clientY: number,
  excludeIds: string[] = [],
): TokenItem | null {
  const exclude = new Set(excludeIds);
  const tokens = allTargetableTokens().filter((t) => !exclude.has(t.id));
  return pickSmallestTokenUnderPointer(clientX, clientY, tokens);
}

export function pickInteractableTokenAt(clientX: number, clientY: number): TokenItem | null {
  return pickInteractableAt(clientX, clientY, allInteractableTokens());
}

/** World aim point for spell beams — center of the visible token footprint. */
export function tokenAimPoint(
  token: TokenItem,
  live?: LiveTransform | null,
): { x: number; z: number } {
  const b = resolveItemBounds(token, live);
  return { x: b.cx, z: b.cz };
}
