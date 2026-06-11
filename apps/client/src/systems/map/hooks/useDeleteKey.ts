import { useEffect } from 'react';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { useSessionStore } from '@/store/sessionStore';
import { deleteCurrentSelection } from '@/systems/scene/deleteSelection';

/** Delete / Backspace removes selected items and wall segments (GM). */
export function useDeleteKey(appReady: boolean) {
  const myRole = useSessionStore((s) => s.myRole);
  const isGM = myRole === 'GM';

  useEffect(() => {
    if (!appReady) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;

      const { selectedIds, selectedWallIndices } = useItemStore.getState();
      if (!isGM && selectedWallIndices.length > 0) return;
      if (selectedIds.length === 0 && selectedWallIndices.length === 0) return;

      e.preventDefault();
      deleteCurrentSelection();
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [appReady, isGM]);
}
