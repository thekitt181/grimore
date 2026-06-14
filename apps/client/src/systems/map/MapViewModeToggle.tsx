import { clsx } from 'clsx';
import { useMapStore } from './store/mapStore';

const GOLD = 'var(--color-accent-gold)';
const BD = 'var(--color-border)';

export function MapViewModeToggle({ variant = 'toolbar' }: { variant?: 'toolbar' | 'dock' }) {
  const viewMode = useMapStore((s) => s.viewMode);
  const toggleViewMode = useMapStore((s) => s.toggleViewMode);
  const is3d = viewMode === '3d';
  const title = is3d
    ? 'Switch to 2D map (right-drag to orbit in 3D)'
    : 'Switch to 3D map (right-drag to orbit, extruded walls)';

  if (variant === 'dock') {
    return (
      <button
        type="button"
        title={title}
        aria-label={is3d ? '2D map' : '3D map'}
        onClick={toggleViewMode}
        className="flex flex-col items-center justify-center rounded-lg shadow-panel min-w-[3.25rem] min-h-[3.25rem] px-2 py-1.5 transition-all"
        style={{
          background: is3d ? 'rgba(201,168,76,0.2)' : 'var(--color-bg-secondary)',
          border: `1px solid ${is3d ? GOLD : BD}`,
          color: is3d ? GOLD : 'var(--color-text-primary)',
        }}
      >
        <span className="text-[10px] font-bold leading-none">{is3d ? '2D' : '3D'}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      title={title}
      aria-label={is3d ? '2D map' : '3D map'}
      onClick={toggleViewMode}
      className={clsx(
        'w-9 h-9 rounded flex flex-col items-center justify-center font-ui transition-all',
        is3d
          ? 'bg-[#c9a84c22] text-[#c9a84c] ring-1 ring-[#c9a84c66]'
          : 'text-[#8a8075] hover:text-[#e8e0d0] hover:bg-[#1c1c28]',
      )}
    >
      <span className="text-[10px] font-bold leading-none">{is3d ? '2D' : '3D'}</span>
    </button>
  );
}
