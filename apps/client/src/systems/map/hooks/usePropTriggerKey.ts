import { useEffect } from 'react';
import { triggerSelectedOrUnderToken } from '@/systems/map/props/dungeonProps';
import { useFirstPersonStore } from '@/systems/map3d/firstPersonStore';

/** Press U to use a selected prop, or the prop under a selected token. */
export function usePropTriggerKey(appReady: boolean) {
  useEffect(() => {
    if (!appReady) return;

    function onKeyDown(e: KeyboardEvent) {
      if (useFirstPersonStore.getState().enabled) return;
      if (e.key !== 'u' && e.key !== 'U') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }

      const result = triggerSelectedOrUnderToken();
      if (result == null) return;
      e.preventDefault();
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [appReady]);
}
