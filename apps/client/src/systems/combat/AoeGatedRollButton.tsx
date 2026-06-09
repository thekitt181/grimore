import { RollButton } from '@/systems/dice/RollButton';
import { aoePlacedFor } from './combatStore';

export function AoeGatedRollButton({
  effectName,
  tokenId,
  aoe,
  notation,
  label,
  variant = 'spell',
}: {
  effectName: string;
  tokenId: string;
  aoe?: { size: number; type: string };
  notation: string;
  label: string;
  variant?: 'default' | 'attack' | 'damage' | 'save' | 'spell';
}) {
  const needsPlacement = Boolean(aoe);
  const placed = !needsPlacement || Boolean(aoePlacedFor(tokenId, effectName));

  if (!placed) {
    return (
      <button
        type="button"
        disabled
        className="font-ui text-xs px-1.5 py-0.5 rounded opacity-40 cursor-not-allowed"
        style={{
          background: 'var(--color-bg-tertiary)',
          border: '1px solid var(--color-border)',
          color: 'var(--color-text-secondary)',
        }}
        title="Place the area on the map first"
      >
        {label}
      </button>
    );
  }

  return <RollButton notation={notation} label={label} variant={variant} />;
}
