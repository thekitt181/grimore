import { useEffect, useState } from 'react';
import { useMapStore } from '@/systems/map/store/mapStore';
import { firstPersonLook } from './firstPersonLook';
import { useFirstPersonStore } from './firstPersonStore';

/** Small banner so GM/player can tell FP + look are live. */
export function FpHud() {
  const enabled = useFirstPersonStore((s) => s.enabled);
  const viewMode = useMapStore((s) => s.viewMode);
  const [yaw, setYaw] = useState(0);

  useEffect(() => {
    if (!enabled || viewMode !== '3d') return;
    let raf = 0;
    const tick = () => {
      setYaw(Math.round(firstPersonLook.yaw));
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
      First person — click map to look · Esc frees cursor · WASD move · yaw {yaw}°
    </div>
  );
}
