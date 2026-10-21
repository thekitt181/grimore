import { useFirstPersonStore } from '@/systems/map3d/firstPersonStore';
import { useInitiativeStore } from '@/systems/map/store/initiativeStore';
import { useTokenDragMeasureStore } from './tokenDragMeasureStore';

const GOLD = 'var(--color-accent-gold)';

/** Drag distance, or remaining walk budget while in first-person during initiative. */
export function TokenMoveDistanceHint() {
  const active = useTokenDragMeasureStore((s) => s.active);
  const feet = useTokenDragMeasureStore((s) => s.feet);
  const screenX = useTokenDragMeasureStore((s) => s.screenX);
  const screenY = useTokenDragMeasureStore((s) => s.screenY);
  const firstPerson = useFirstPersonStore((s) => s.enabled);
  const initiativeOn = useInitiativeStore((s) => s.isActive);

  if (!active) return null;

  const label =
    firstPerson && initiativeOn
      ? (feet <= 0 ? '0 ft — not your turn or out of movement' : `${feet} ft left`)
      : `${feet} ft`;

  return (
    <div
      className="fixed z-[180] rounded px-2 py-1 shadow-lg pointer-events-none font-ui text-xs font-semibold tabular-nums"
      style={{
        left: screenX + 14,
        top: screenY + 14,
        background: 'var(--color-bg-secondary)',
        border: `1px solid ${GOLD}`,
        color: GOLD,
      }}
    >
      {label}
    </div>
  );
}
