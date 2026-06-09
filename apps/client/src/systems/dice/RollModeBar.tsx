import type { RollMode } from '@grimoire/dice-engine';
import { useDiceStore } from './diceStore';

const GOLD = 'var(--color-accent-gold)';
const BD = 'var(--color-border)';

const MODES: { id: RollMode; label: string; title: string }[] = [
  { id: 'normal', label: 'Normal', title: 'Normal roll' },
  { id: 'advantage', label: 'Adv', title: 'Advantage (e.g. Rage, Help)' },
  { id: 'disadvantage', label: 'Dis', title: 'Disadvantage' },
];

/** Persistent manual advantage/disadvantage for d20 rolls and attacks. */
export function RollModeBar({ className = '' }: { className?: string }) {
  const rollMode = useDiceStore((s) => s.rollMode);
  const setRollMode = useDiceStore((s) => s.setRollMode);

  return (
    <div
      className={`rounded-lg shadow-panel p-0.5 ${className}`}
      style={{ background: 'var(--color-bg-secondary)', border: `1px solid ${BD}` }}
      title="Manual roll mode — applies to d20 attacks and rolls until changed"
    >
      <p className="font-ui text-[8px] text-center px-1 pt-0.5 pb-0.5" style={{ color: 'var(--color-text-secondary)' }}>
        Roll mode
      </p>
      <div className="flex gap-0.5 px-0.5 pb-0.5">
        {MODES.map(({ id, label, title }) => (
          <button
            key={id}
            type="button"
            title={title}
            onClick={() => setRollMode(id)}
            className="font-ui text-[10px] px-2 py-1 rounded transition-all min-w-[2.5rem]"
            style={{
              background: rollMode === id ? 'rgba(201,168,76,0.2)' : 'var(--color-bg-tertiary)',
              border: `1px solid ${rollMode === id ? GOLD : BD}`,
              color: rollMode === id ? GOLD : 'var(--color-text-secondary)',
            }}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
