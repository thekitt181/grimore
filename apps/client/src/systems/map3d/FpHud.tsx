import { useEffect, useRef } from 'react';
import { useMapStore } from '@/systems/map/store/mapStore';
import { firstPersonLook } from './firstPersonLook';
import { useFirstPersonStore } from './firstPersonStore';

/** Small banner so GM/player can tell FP + look are live. */
export function FpHud() {
  const enabled = useFirstPersonStore((s) => s.enabled);
  const viewMode = useMapStore((s) => s.viewMode);
  const yawEl = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!enabled || viewMode !== '3d') return;
    let raf = 0;
    let last = Number.NaN;
    const tick = () => {
      const y = Math.round(firstPersonLook.yaw);
      if (y !== last && yawEl.current) {
        last = y;
        yawEl.current.textContent = String(y);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [enabled, viewMode]);

  if (!enabled || viewMode !== '3d') return null;

  return (
    <div
      className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 z-[26] rounded-md px-3 py-1.5 font-ui text-xs shadow-panel"
      style={{
        background: 'rgba(10,10,15,0.88)',
        border: '1px solid var(--color-accent-gold)',
        color: 'var(--color-accent-gold)',
      }}
    >
      First person — click map to look · Esc frees cursor · WASD move · yaw{' '}
      <span ref={yawEl}>0</span>°
    </div>
  );
}
