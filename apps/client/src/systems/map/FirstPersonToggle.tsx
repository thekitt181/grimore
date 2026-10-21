import { useMapStore } from './store/mapStore';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { useFirstPersonStore } from '@/systems/map3d/firstPersonStore';
import { resolveFirstPersonToken } from '@/systems/map3d/resolveFirstPersonToken';
import { resolveTokenForFirstPersonEntry } from '@/systems/map3d/resolveTokenForFirstPersonEntry';
import { commitFirstPersonLive } from '@/systems/map3d/firstPersonMove';
import { clearFirstPersonPose, seedFirstPersonPose } from '@/systems/map3d/firstPersonPose';
import { resetFirstPersonMotion } from '@/systems/map3d/firstPersonMotion';
import { clearWalkPose } from '@/systems/scene/token/walkPoseBus';
import { useLiveTransformStore } from '@/systems/scene/store/liveTransformStore';
import { fpGlobal } from '@/systems/map3d/fpGlobals';

const GOLD = 'var(--color-accent-gold)';
const BD = 'var(--color-border)';

/** Players (and GM) enter first-person in 3D — WASD walk, mouse look. */
export function FirstPersonToggle({ variant = 'dock' }: { variant?: 'toolbar' | 'dock' }) {
  const viewMode = useMapStore((s) => s.viewMode);
  const enabled = useFirstPersonStore((s) => s.enabled);
  const setEnabled = useFirstPersonStore((s) => s.setEnabled);

  if (viewMode !== '3d') return null;

  function exitFirstPerson() {
    const token = resolveFirstPersonToken();
    const tokenId = token?.id ?? useFirstPersonStore.getState().tokenId;
    if (token) commitFirstPersonLive(token);
    void import('@/systems/map3d/fpPoseSync').then(({ stopFpPosePublisher }) => {
      stopFpPosePublisher();
    });
    if (tokenId) {
      clearWalkPose(tokenId);
      useLiveTransformStore.getState().clear([tokenId]);
    }
    fpGlobal.walkStreaming = false;
    clearFirstPersonPose();
    resetFirstPersonMotion();
    if (document.pointerLockElement) document.exitPointerLock();
    // setEnabled(false) also clearSelection()
    setEnabled(false);
  }

  function toggle() {
    if (enabled) {
      exitFirstPerson();
      return;
    }
    const token = resolveTokenForFirstPersonEntry();
    if (!token) {
      window.alert('Select a token on the map (or place one) before entering first person.');
      return;
    }
    seedFirstPersonPose(token);
    resetFirstPersonMotion();
    setEnabled(true, { seedYawDeg: token.rotation, tokenId: token.id });
    // Drop selection so gizmo/drag can't move tokens while walking with WASD.
    useItemStore.getState().clearSelection();
  }

  const title = enabled
    ? 'Leave first person — token is deselected so it won’t move by accident'
    : 'First person — select a token, FP, then click+drag the map to look (or right-drag)';

  if (variant === 'dock') {
    return (
      <button
        type="button"
        title={title}
        aria-label={enabled ? 'Leave first person' : 'First person'}
        onClick={toggle}
        className="flex flex-col items-center justify-center rounded-lg shadow-panel min-w-[3.25rem] min-h-[3.25rem] px-2 py-1.5 transition-all"
        style={{
          background: enabled ? 'rgba(201,168,76,0.2)' : 'var(--color-bg-secondary)',
          border: `1px solid ${enabled ? GOLD : BD}`,
          color: enabled ? GOLD : 'var(--color-text-primary)',
        }}
      >
        <span className="text-[10px] font-bold leading-none">FP</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      title={title}
      aria-label={enabled ? 'Leave first person' : 'First person'}
      onClick={toggle}
      className="w-9 h-9 rounded flex flex-col items-center justify-center font-ui transition-all"
      style={{
        background: enabled ? 'rgba(201,168,76,0.14)' : 'transparent',
        color: enabled ? GOLD : '#8a8075',
        boxShadow: enabled ? `inset 0 0 0 1px ${GOLD}66` : undefined,
      }}
    >
      <span className="text-[10px] font-bold leading-none">FP</span>
    </button>
  );
}
