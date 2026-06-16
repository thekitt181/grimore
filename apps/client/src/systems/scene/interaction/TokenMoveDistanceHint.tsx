import { useTokenDragMeasureStore } from './tokenDragMeasureStore';

const GOLD = 'var(--color-accent-gold)';

/** Shows how far the dragged token(s) have moved from their start position. */
export function TokenMoveDistanceHint() {
  const active = useTokenDragMeasureStore((s) => s.active);
  const feet = useTokenDragMeasureStore((s) => s.feet);
  const screenX = useTokenDragMeasureStore((s) => s.screenX);
  const screenY = useTokenDragMeasureStore((s) => s.screenY);

  if (!active) return null;

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
      {feet} ft
    </div>
  );
}
