import { emitItemUpdateLive } from '@/systems/scene/sceneSync';
import { useItemStore } from '@/systems/scene/store/itemStore';
import type { Item } from '@/systems/scene/types';
import type { LiveTransform } from '@/systems/scene/store/liveTransformStore';

const INTERVAL_MS = 48;
let lastEmitAt = 0;

/** Props / handouts that should stream transform to remotes (FP 3D). */
export function isLiveTransformProp(item: Item | undefined): boolean {
  return item?.type === 'image' || item?.type === 'handout';
}

/**
 * Throttled live sync while GM sizes / rotates / moves a prop.
 * Final `emitItemUpdate` on pointer-up still commits for persistence.
 */
export function emitPropTransformLive(
  patches: Array<{ id: string; patch: LiveTransform }>,
): void {
  if (!patches.length) return;
  const items = useItemStore.getState().items;
  const propPatches = patches.filter((p) => isLiveTransformProp(items[p.id]));
  if (!propPatches.length) return;

  const now = performance.now();
  if (now - lastEmitAt < INTERVAL_MS) return;
  lastEmitAt = now;

  emitItemUpdateLive(
    propPatches.map(({ id, patch }) => ({
      id,
      patch: patch as Partial<Item>,
    })),
  );
}
