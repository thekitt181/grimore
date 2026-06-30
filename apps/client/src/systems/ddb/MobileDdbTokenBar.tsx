import { useItemStore } from '@/systems/scene/store/itemStore';
import { useMapStore } from '@/systems/map/store/mapStore';
import { useSessionStore } from '@/store/sessionStore';
import type { TokenItem } from '@/systems/scene/types';
import { isMobileClient } from '@/lib/socket';
import { useDdbStore } from './ddbStore';
import { isDdbPcToken } from './ddbTokenUtils';
import { useTokenStore } from '@/systems/scene/store/tokenStore';
import { playerCanRotateToken } from '@/systems/scene/token/clientTokenVisibility';

/**
 * Touch-friendly token shortcuts on mobile (no right-click for orbit / context menu).
 */
export function MobileDdbTokenBar() {
  const selectedIds = useItemStore((s) => s.selectedIds);
  const items = useItemStore((s) => s.items);
  const myUserId = useSessionStore((s) => s.myUserId);
  const myRole = useSessionStore((s) => s.myRole);
  const openSheet = useDdbStore((s) => s.openSheet);
  const openPcActions = useDdbStore((s) => s.openPcActions);
  const rotateToken = useTokenStore((s) => s.rotateToken);
  const resetTokenViewAngle = useMapStore((s) => s.resetTokenViewAngle);

  if (!isMobileClient()) return null;

  const single = selectedIds.length === 1 ? items[selectedIds[0]!] : null;
  if (!single || single.type !== 'token') return null;

  const token = single as TokenItem;
  const isPc = isDdbPcToken(token);
  const canRotate = playerCanRotateToken(token, myUserId);
  const hasModel = Boolean(token.modelUrl);
  const showViewReset = hasModel && (myRole === 'GM' || canRotate);

  if (!isPc && !canRotate && !showViewReset) return null;

  return (
    <div
      className="absolute left-1/2 -translate-x-1/2 z-40 flex gap-2 px-2 pointer-events-auto flex-wrap justify-center max-w-[min(100vw-1rem,28rem)]"
      style={{ bottom: 'max(5.5rem, calc(env(safe-area-inset-bottom, 0px) + 4.5rem))' }}
    >
      {canRotate && (
        <button
          type="button"
          className="btn-primary text-xs py-2 px-3 shadow-panel min-h-[44px]"
          onClick={() => rotateToken(token.id, -45)}
          aria-label="Rotate token left"
        >
          ⟲
        </button>
      )}
      {showViewReset && (
        <button
          type="button"
          className="btn-primary text-xs py-2 px-3 shadow-panel min-h-[44px]"
          onClick={() => resetTokenViewAngle(token.id)}
          aria-label="Reset token view angle"
          title="Reset mini view angle"
        >
          ↺ View
        </button>
      )}
      {isPc && (
        <>
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
        </>
      )}
      {canRotate && (
        <button
          type="button"
          className="btn-primary text-xs py-2 px-3 shadow-panel min-h-[44px]"
          onClick={() => rotateToken(token.id, 45)}
          aria-label="Rotate token right"
        >
          ⟳
        </button>
      )}
    </div>
  );
}
