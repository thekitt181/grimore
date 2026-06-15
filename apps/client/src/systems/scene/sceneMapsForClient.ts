import type { Item, MapItem } from './types';

/** Maps to render — GM sees all visible maps; players only see the active map. */
export function sceneMapsForClient(
  items: readonly Item[],
  activeMapId: string | null,
  gm: boolean,
): MapItem[] {
  const visible = items.filter(
    (i): i is MapItem => i.type === 'map' && i.visible !== false,
  );
  if (gm) return visible;
  if (activeMapId) {
    const active = visible.find((m) => m.id === activeMapId);
    if (active) return [active];
  }
  return visible.length > 0 ? [visible[0]!] : [];
}
