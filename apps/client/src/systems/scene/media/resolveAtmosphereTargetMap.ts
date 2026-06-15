import { getActiveMap, useItemStore } from '../store/itemStore';
import type { MapItem } from '../types';

/** Map that weather/time overlays should clip to (selected map wins over active). */
export function resolveAtmosphereTargetMap(): MapItem | null {
  const { items, selectedIds } = useItemStore.getState();
  const selectedMaps = selectedIds
    .map((id) => items[id])
    .filter((item): item is MapItem => item?.type === 'map');

  if (selectedMaps.length === 1) {
    return selectedMaps[0] ?? null;
  }

  return getActiveMap();
}
