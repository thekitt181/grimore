import { useLiveTransformStore } from '@/systems/scene/store/liveTransformStore';
import type { Item } from '@/systems/scene/types';

/** Item position/size merged with in-progress drag transforms. */
export function useLiveItemBounds(item: Item) {
  const live = useLiveTransformStore((s) => s.byId[item.id]);
  const liveTick = useLiveTransformStore((s) => s.tick);
  void liveTick;

  const x = live?.x ?? item.x;
  const y = live?.y ?? item.y;
  const rotation = live?.rotation ?? item.rotation ?? 0;
  const cx = x + item.width / 2;
  const cz = y + item.height / 2;

  return { x, y, cx, cz, rotation, width: item.width, height: item.height };
}
