import type { Item, MapItem, TokenItem } from '../types';
import type { MapViewMode } from '@/systems/map/store/mapStore';

/** Explicit or inferred 2D (Pixi) vs 3D (Three.js) render path. */
export function getTokenRenderType(token: TokenItem): '2d' | '3d' {
  if (token.renderType) return token.renderType;
  if (token.modelUrl && !token.imageUrl) return '3d';
  if (token.imageUrl && !token.modelUrl) return '2d';
  return token.modelUrl ? '3d' : '2d';
}

export function is2dToken(token: TokenItem): boolean {
  return getTokenRenderType(token) === '2d';
}

export function is3dToken(token: TokenItem): boolean {
  return getTokenRenderType(token) === '3d';
}

/**
 * Token has a GLB/STL that should render as a Three.js mini.
 * True in both 2D and 3D views (even when renderType is "2d").
 */
export function tokenUsesModelMesh(token: TokenItem, _viewMode?: MapViewMode): boolean {
  return Boolean(token.modelUrl);
}

/** Token body is rendered in the Three.js overlay (2D model mini or full 3D view). */
export function tokenRendersInThree(token: TokenItem, viewMode: MapViewMode): boolean {
  if (token.modelUrl) return true;
  // Flat tokens still get Three meshes in 3D view (Token2DFlat / Token3DMesh).
  return viewMode === '3d';
}

/** Selection gizmo for this token is drawn in Three.js — not the Pixi overlay. */
export function tokenSelectionGizmoRendersInThree(
  item: Item,
  viewMode: MapViewMode,
): boolean {
  if (item.type !== 'token') return false;
  if (tokenUsesModelMesh(item as TokenItem)) return true;
  if (viewMode === '3d') return true;
  return false;
}

/** Selection gizmo for a GLB map is drawn in Three.js — not the Pixi overlay. */
export function mapSelectionGizmoRendersInThree(map: MapItem): boolean {
  return Boolean(map.modelUrl);
}

/** Whether Pixi should skip the selection gizmo (Three.js owns it). */
export function itemSelectionGizmoRendersInThree(item: Item, viewMode: MapViewMode): boolean {
  if (item.type === 'token') return tokenSelectionGizmoRendersInThree(item, viewMode);
  if (item.type === 'map') return mapSelectionGizmoRendersInThree(item);
  return false;
}

/** Whether Pixi should skip drawing the token body (Three.js owns it). */
export function tokenHidesPixiBody(
  token: TokenItem,
  viewMode: MapViewMode,
  pixiTokenFallback: boolean,
  gm2dEditor = false,
): boolean {
  // Live 2D editor: Pixi is above the underlay — flat tokens stay in Pixi; GLB minis in Three.
  if (gm2dEditor) return Boolean(token.modelUrl);
  // GLB/STL minis always render in Three — hide flat Pixi art in 2D and 3D.
  if (token.modelUrl) return true;
  if (viewMode === '3d') {
    if (pixiTokenFallback) return false;
    return is3dToken(token);
  }
  return false;
}
