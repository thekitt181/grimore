import { useMapStore } from '@/systems/map/store/mapStore';
import { useFirstPersonStore } from '@/systems/map3d/firstPersonStore';
import { resolveFirstPersonToken } from '@/systems/map3d/resolveFirstPersonToken';
import { useSessionStore } from '@/store/sessionStore';
import { canUsePropUnderToken } from './dungeonProps';
import { fpInteractPropForToken } from './fpPropInteract';
import { usePropInteractRequestStore } from './propInteractRequestStore';

/** Center-screen hint while a usable prop is in range (first person). */
export function FpInteractHint() {
  const viewMode = useMapStore((s) => s.viewMode);
  const enabled = useFirstPersonStore((s) => s.enabled);
  const playerWaiting = usePropInteractRequestStore((s) => s.playerWaiting);
  const gm = useSessionStore((s) => s.myRole === 'GM');

  if (viewMode !== '3d' || !enabled || playerWaiting) return null;

  const token = resolveFirstPersonToken();
  if (!token || !canUsePropUnderToken(token)) return null;
  const prop = fpInteractPropForToken(token, gm);
  if (!prop) return null;

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
      <kbd className="px-1.5 py-0.5 rounded text-[10px] font-bold" style={{ background: 'rgba(201,168,76,0.2)', color: 'var(--color-accent-gold)' }}>
        E
      </kbd>
      {' '}— {prop.name}
    </div>
  );
}
