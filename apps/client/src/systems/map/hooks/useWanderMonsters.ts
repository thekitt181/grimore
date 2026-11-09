import { useEffect } from 'react';
import { useSessionStore } from '@/store/sessionStore';
import { useFirstPersonStore } from '@/systems/map3d/firstPersonStore';
import { stopAllWandering, tickWanderingMonsters, toggleChosenWandering } from '@/systems/map/dungeon/wanderMonsters';

function typingTarget(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  return Boolean(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable));
}

/** GM: Shift+W starts/stops tokens marked to wander. . stops all. */
export function useWanderMonsters(appReady: boolean) {
  const isGM = useSessionStore((s) => s.myRole === 'GM');

  useEffect(() => {
    if (!appReady || !isGM) return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      tickWanderingMonsters(now, dt);
      raf = window.requestAnimationFrame(loop);
    };
    raf = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(raf);
  }, [appReady, isGM]);

  useEffect(() => {
    if (!appReady || !isGM) return;

    function onKeyDown(e: KeyboardEvent) {
      if (typingTarget(e.target)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.repeat) return;

      if (e.key === '.') {
        e.preventDefault();
        stopAllWandering();
        return;
      }

      const wanderKey = e.code === 'KeyW' || e.key === 'W' || e.key === 'w';
      if (!e.shiftKey || !wanderKey) return;

      e.preventDefault();
      if (useFirstPersonStore.getState().enabled) return;
      toggleChosenWandering();
    }

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [appReady, isGM]);
}
