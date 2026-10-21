import { useMapStore } from './store/mapStore';
import { useSessionStore } from '@/store/sessionStore';

const GOLD = 'var(--color-accent-gold)';
const BD = 'var(--color-border)';

/** GM only in 3D — lock map select/move/pan/orbit; tokens stay pickable for FP. */
export function GmMapFreezeToggle({ variant = 'dock' }: { variant?: 'toolbar' | 'dock' }) {
  const viewMode = useMapStore((s) => s.viewMode);
  const frozen = useMapStore((s) => s.mapFrozen);
  const toggle = useMapStore((s) => s.toggleMapFrozen);
  const isGM = useSessionStore((s) => s.myRole === 'GM');

  if (!isGM || viewMode !== '3d') return null;

  const title = frozen
    ? 'Unfreeze map — allow map select, move, pan, and orbit'
    : 'Freeze map — lock the map in place; still pick tokens for first person';

  if (variant === 'dock') {
    return (
      <button
        type="button"
        title={title}
        aria-label={frozen ? 'Unfreeze map' : 'Freeze map'}
        onClick={() => toggle()}
        className="flex flex-col items-center justify-center rounded-lg shadow-panel min-w-[3.25rem] min-h-[3.25rem] px-2 py-1.5 transition-all"
        style={{
          background: frozen ? 'rgba(201,168,76,0.2)' : 'var(--color-bg-secondary)',
          border: `1px solid ${frozen ? GOLD : BD}`,
          color: frozen ? GOLD : 'var(--color-text-primary)',
        }}
      >
        <span className="text-[10px] font-bold leading-none">{frozen ? 'LOCK' : 'FREE'}</span>
        <span className="text-[8px] opacity-70 leading-none mt-0.5">map</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      title={title}
      aria-label={frozen ? 'Unfreeze map' : 'Freeze map'}
      onClick={() => toggle()}
      className="w-9 h-9 rounded flex flex-col items-center justify-center font-ui transition-all"
      style={{
        background: frozen ? 'rgba(201,168,76,0.14)' : 'transparent',
        color: frozen ? GOLD : '#8a8075',
        boxShadow: frozen ? `inset 0 0 0 1px ${GOLD}66` : undefined,
      }}
    >
      <span className="text-[9px] font-bold leading-none">{frozen ? 'LK' : 'FR'}</span>
    </button>
  );
}
