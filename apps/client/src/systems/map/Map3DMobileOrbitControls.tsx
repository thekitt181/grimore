import { useMapStore } from '@/systems/map/store/mapStore';
import { useItemStore } from '@/systems/scene/store/itemStore';

const GOLD = 'var(--color-accent-gold)';
const BD = 'var(--color-border)';

/** Compact 3D orbit controls for mobile (right-drag is unavailable on touch). */
export function Map3DMobileOrbitControls() {
  const viewMode = useMapStore((s) => s.viewMode);
  const adjustView3dOrbit = useMapStore((s) => s.adjustView3dOrbit);
  const selectedKey = useItemStore((s) =>
    s.selectedIds.length === 1 ? s.selectedIds[0]! : '',
  );

  if (viewMode !== '3d') return null;

  function orbitTokenId(): string | undefined {
    const item = useItemStore.getState().items[selectedKey];
    return item?.type === 'token' ? selectedKey : undefined;
  }

  function adjust(deltaAzimuth: number, deltaPolar: number) {
    adjustView3dOrbit(deltaAzimuth, deltaPolar, orbitTokenId());
  }

  return (
    <div
      className="fixed z-[59] flex gap-1 pointer-events-auto md:hidden"
      style={{
        left: 'max(0.75rem, env(safe-area-inset-left, 0px))',
        bottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))',
      }}
    >
      <OrbitBtn label="↶" title="Rotate left" onClick={() => adjust(-0.28, 0)} />
      <OrbitBtn label="↷" title="Rotate right" onClick={() => adjust(0.28, 0)} />
      <OrbitBtn label="▴" title="Tilt up" onClick={() => adjust(0, -0.14)} />
      <OrbitBtn label="▾" title="Tilt down" onClick={() => adjust(0, 0.14)} />
    </div>
  );
}

function OrbitBtn({
  label,
  title,
  onClick,
}: {
  label: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="flex items-center justify-center rounded-lg shadow-panel min-w-[2.75rem] min-h-[2.75rem] text-base font-ui transition-all"
      style={{
        background: 'var(--color-bg-secondary)',
        border: `1px solid ${BD}`,
        color: GOLD,
      }}
    >
      {label}
    </button>
  );
}
