import { useItemStore } from '@/systems/scene/store/itemStore';
import type { TokenItem } from '@/systems/scene/types';
import { isMobileClient } from '@/lib/socket';
import { useDdbStore } from './ddbStore';
import { isDdbPcToken } from './ddbTokenUtils';

/**
 * Touch-friendly shortcuts for D&D Beyond PC tokens (no right-click on mobile).
 */
export function MobileDdbTokenBar() {
  const selectedIds = useItemStore((s) => s.selectedIds);
  const items = useItemStore((s) => s.items);
  const openSheet = useDdbStore((s) => s.openSheet);
  const openPcActions = useDdbStore((s) => s.openPcActions);

  if (!isMobileClient()) return null;

  const single = selectedIds.length === 1 ? items[selectedIds[0]!] : null;
  if (!single || single.type !== 'token') return null;

  const token = single as TokenItem;
  if (!isDdbPcToken(token)) return null;

  return (
    <div
      className="absolute left-1/2 -translate-x-1/2 z-40 flex gap-2 px-2 pointer-events-auto"
      style={{ bottom: '5.5rem' }}
    >
      <button
        type="button"
        className="btn-primary text-xs py-2 px-4 shadow-panel min-h-[44px]"
        onClick={() => openSheet(token)}
      >
        📜 Sheet
      </button>
      <button
        type="button"
        className="btn-primary text-xs py-2 px-4 shadow-panel min-h-[44px]"
        onClick={() => openPcActions(token)}
      >
        ⚔ Actions
      </button>
    </div>
  );
}
