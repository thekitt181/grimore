import { useLiveTransformStore } from '@/systems/scene/store/liveTransformStore';
import { useItemStore } from '@/systems/scene/store/itemStore';
import type { Item } from '@/systems/scene/types';
import { resolveItemBounds } from './sceneItemBounds';

/** Item position/size merged with in-progress drag transforms (store is source of truth). */
export function useLiveItemBounds(item: Item) {
  const storeItem = useItemStore((s) => s.items[item.id]) ?? item;
  const live = useLiveTransformStore((s) => s.byId[item.id]);
  const liveTick = useLiveTransformStore((s) => s.tick);
  void liveTick;

  return resolveItemBounds(storeItem, live);
}
