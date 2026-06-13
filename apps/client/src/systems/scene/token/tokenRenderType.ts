import type { TokenItem } from '../types';
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

/** Token body is rendered in the Three.js overlay (2D model preview or full 3D view). */
export function tokenRendersInThree(token: TokenItem, viewMode: MapViewMode): boolean {
  if (viewMode === '3d') return true;
  return is3dToken(token) && Boolean(token.modelUrl);
}
