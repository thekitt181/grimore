import { useItemStore } from '@/systems/scene/store/itemStore';

const localTokenMoveCommitAt = new Map<string, number>();
const LOCAL_COMMIT_GUARD_MS = 600;

/** Call when this client commits token feet to item store (drag release, etc.). */
export function noteLocalTokenMoveCommit(tokenId: string): void {
  localTokenMoveCommitAt.set(tokenId, performance.now());
}

/** Drop token:live / fp:pose echoes that still carry mid-drag feet right after our commit. */
export function isStaleLiveAfterLocalCommit(tokenId: string, x: number, y: number): boolean {
  const at = localTokenMoveCommitAt.get(tokenId);
  if (!at || performance.now() - at > LOCAL_COMMIT_GUARD_MS) return false;
  const item = useItemStore.getState().items[tokenId];
  if (!item || item.type !== 'token') return false;
  return Math.hypot(x - item.x, y - item.y) > 1.5;
}
