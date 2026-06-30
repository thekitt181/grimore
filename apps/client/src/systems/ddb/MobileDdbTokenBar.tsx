import { useItemStore } from '@/systems/scene/store/itemStore';
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
  const resetTokenRotation = useTokenStore((s) => s.resetTokenRotation);

  if (!isMobileClient()) return null;

  const single = selectedIds.length === 1 ? items[selectedIds[0]!] : null;
  if (!single || single.type !== 'token') return null;

  const token = single as TokenItem;
  const isPc = isDdbPcToken(token);
  const isGM = myRole === 'GM';
  const canRotate = playerCanRotateToken(token, myUserId);
  const canAdjustRotation = (isGM || canRotate) && !token.locked && token.visible !== false;

  if (!isPc && !canAdjustRotation) return null;

  return (
    <div
      className="absolute left-1/2 -translate-x-1/2 z-40 flex gap-2 px-2 pointer-events-auto flex-wrap justify-center max-w-[min(100vw-1rem,28rem)]"
      style={{ bottom: 'max(5.5rem, calc(env(safe-area-inset-bottom, 0px) + 4.5rem))' }}
    >
      {canAdjustRotation && (
        <button
          type="button"
          className="btn-primary text-xs py-2 px-3 shadow-panel min-h-[44px]"
          onClick={() => rotateToken(token.id, -45)}
          aria-label="Rotate token left"
        >
          ⟲
        </button>
      )}
      {canAdjustRotation && (
        <button
          type="button"
          className="btn-primary text-xs py-2 px-3 shadow-panel min-h-[44px]"
          onClick={() => resetTokenRotation(token.id)}
          aria-label="Reset token rotation"
          title={token.modelUrl ? 'Reset facing and mini view angle' : 'Reset facing to 0°'}
        >
          ↺ Reset
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
      {canAdjustRotation && (
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
