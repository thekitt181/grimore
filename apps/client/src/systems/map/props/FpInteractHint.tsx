import { useEffect, useState } from 'react';
import { useMapStore } from '@/systems/map/store/mapStore';
import { useFirstPersonStore } from '@/systems/map3d/firstPersonStore';
import { resolveFirstPersonToken } from '@/systems/map3d/resolveFirstPersonToken';
import { useSessionStore } from '@/store/sessionStore';
import { canUsePropUnderToken } from './dungeonProps';
import { fpInteractPropForToken } from './fpPropInteract';
import { usePropInteractRequestStore } from './propInteractRequestStore';

/** Center-screen hint while a visible prop is within 10 ft and in your look cone. */
export function FpInteractHint() {
  const viewMode = useMapStore((s) => s.viewMode);
  const enabled = useFirstPersonStore((s) => s.enabled);
  const playerWaiting = usePropInteractRequestStore((s) => s.playerWaiting);
  const gm = useSessionStore((s) => s.myRole === 'GM');
  const [propName, setPropName] = useState<string | null>(null);

  useEffect(() => {
    if (viewMode !== '3d' || !enabled || playerWaiting) {
      setPropName(null);
      return;
    }
    let raf = 0;
    const tick = () => {
      const token = resolveFirstPersonToken();
      if (!token || !canUsePropUnderToken(token)) {
        setPropName(null);
      } else {
        const prop = fpInteractPropForToken(token, gm);
        setPropName(prop?.name ?? null);
      }
      raf = window.setTimeout(tick, 120);
    };
    tick();
    return () => window.clearTimeout(raf);
  }, [viewMode, enabled, playerWaiting, gm]);

  if (viewMode !== '3d' || !enabled || playerWaiting || !propName) return null;

  return (
    <div
      className="fixed left-1/2 bottom-28 z-[205] -translate-x-1/2 pointer-events-none px-3 py-1.5 rounded-lg font-ui text-xs shadow-panel"
      style={{
        background: 'rgba(10,10,15,0.82)',
        border: '1px solid var(--color-border-gold)',
        color: 'var(--color-text-primary)',
      }}
    >
      Press{' '}
      <kbd
        className="px-1.5 py-0.5 rounded text-[10px] font-bold"
        style={{ background: 'rgba(201,168,76,0.2)', color: 'var(--color-accent-gold)' }}
      >
        E
      </kbd>
      {' '}— {propName}
    </div>
  );
}
