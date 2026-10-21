import { useMapStore } from './store/mapStore';
import { useSessionStore } from '@/store/sessionStore';
import { useFirstPersonStore } from '@/systems/map3d/firstPersonStore';
const GOLD = 'var(--color-accent-gold)';
const BD = 'var(--color-border)';

/** GM only — open a live 2D map editor beside the 3D view. */
export function Gm2dEditorToggle({ variant = 'dock' }: { variant?: 'toolbar' | 'dock' }) {
  const viewMode = useMapStore((s) => s.viewMode);
  const open = useMapStore((s) => s.gm2dEditorOpen);
  const toggle = useMapStore((s) => s.toggleGm2dEditor);
  const isGM = useSessionStore((s) => s.myRole === 'GM');

  if (!isGM || viewMode !== '3d') return null;

  function onClick() {
    if (!open && useFirstPersonStore.getState().enabled) {
      useFirstPersonStore.getState().setEnabled(false);
      if (document.pointerLockElement) document.exitPointerLock();
    }
    toggle();
    window.setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
  }

  const title = open
    ? 'Hide the live 2D map editor'
    : 'Open live 2D map beside 3D — select, move, walls, fog, tokens';

  if (variant === 'dock') {
    return (
      <button
        type="button"
        title={title}
        aria-label={open ? 'Close 2D editor' : 'Open 2D editor'}
        onClick={onClick}
        className="flex flex-col items-center justify-center rounded-lg shadow-panel min-w-[3.25rem] min-h-[3.25rem] px-2 py-1.5 transition-all"
        style={{
          background: open ? 'rgba(201,168,76,0.2)' : 'var(--color-bg-secondary)',
          border: `1px solid ${open ? GOLD : BD}`,
          color: open ? GOLD : 'var(--color-text-primary)',
        }}
      >
        <span className="text-[10px] font-bold leading-none">2D</span>
        <span className="text-[8px] opacity-70 leading-none mt-0.5">edit</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      title={title}
      aria-label={open ? 'Close 2D editor' : 'Open 2D editor'}
      onClick={onClick}
      className="w-9 h-9 rounded flex flex-col items-center justify-center font-ui transition-all"
      style={{
        background: open ? 'rgba(201,168,76,0.14)' : 'transparent',
        color: open ? GOLD : '#8a8075',
        boxShadow: open ? `inset 0 0 0 1px ${GOLD}66` : undefined,
      }}
    >
      <span className="text-[9px] font-bold leading-none">2D+</span>
    </button>
  );
}
