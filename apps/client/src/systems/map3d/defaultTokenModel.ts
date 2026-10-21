import type { TokenItem } from '@/systems/scene/types';

/** Optional shared walker asset (Sketchfab CC-BY: bertanorgun — Demonic Ethereal Conjurer). */
export const DEFAULT_TOKEN_MODEL_URL = '/tokens3d/demonic_ethereal_conjurer.glb';

/** Only returns a URL when the token already has its own `modelUrl` — never swaps art. */
export function resolveTokenModelUrl(token: TokenItem): string | null {
  return token.modelUrl ?? null;
}
