import { useEffect, useMemo, useState } from 'react';
import { formatDiceNotation, parseSimpleDiceNotation } from '@grimoire/dice-engine';
import { useDiceStore } from '@/systems/dice/diceStore';
import { BD, GOLD } from '../dmStyles';

const DICE = [4, 6, 8, 10, 12, 20, 100];
const PRESETS = [
  { label: 'Perception', expr: '1d20' },
  { label: 'Stealth', expr: '1d20' },
  { label: 'Wandering', expr: '1d12' },
  { label: 'Table', expr: '1d100' },
  { label: 'Fireball', expr: '8d6' },
] as const;

export function SecretRollsTab() {
  const [expr, setExpr] = useState('1d20');
  const [error, setError] = useState('');
  const performRoll = useDiceStore((s) => s.performRoll);
  const setIsSecret = useDiceStore((s) => s.setIsSecret);
  const isSecret = useDiceStore((s) => s.isSecret);
  const history = useDiceStore((s) => s.history);

  useEffect(() => {
    setIsSecret(true);
    return () => setIsSecret(false);
  }, [setIsSecret]);

  const secretHistory = useMemo(
    () => history.filter((h) => h.isSecret).slice(0, 8),
    [history],
  );

  function roll(expression: string, label?: string) {
    setError('');
    const result = performRoll(expression, label ?? `GM secret · ${expression}`, { isSecret: true });
    if (!result) setError('Invalid expression — try 2d6+3');
  }

  const parsed = parseSimpleDiceNotation(expr);
  const built = parsed ? formatDiceNotation(parsed.count, parsed.sides, parsed.modifier) : expr;

  return (
    <div className="space-y-3">
      <p className="font-ui text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>
        Rolls here are hidden from players (GM-only in the dice tray).
      </p>

      <div className="flex items-center gap-2">
        <label className="font-ui text-[10px] flex items-center gap-1.5" style={{ color: 'var(--color-text-secondary)' }}>
          <input type="checkbox" checked={isSecret} onChange={(e) => setIsSecret(e.target.checked)} />
          Secret roll
        </label>
      </div>

      <div className="grid grid-cols-4 gap-1">
        {DICE.map((d) => (
          <button
            key={d}
            type="button"
            className="py-1.5 rounded font-display text-xs"
            style={{ background: 'var(--color-bg-tertiary)', border: `1px solid ${BD}`, color: GOLD }}
            onClick={() => roll(`1d${d}`, `GM secret · d${d}`)}
          >
            d{d}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-1">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            className="text-[10px] px-2 py-0.5 rounded font-ui"
            style={{ border: `1px solid ${BD}`, color: 'var(--color-text-secondary)' }}
            onClick={() => roll(p.expr, `GM secret · ${p.label}`)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="flex gap-1">
        <input
          className="input-dark text-xs py-1 flex-1"
          value={expr}
          onChange={(e) => setExpr(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && roll(built)}
          placeholder="2d6+3"
        />
        <button type="button" className="btn-primary text-xs px-3 py-1" onClick={() => roll(built)}>
          Roll
        </button>
      </div>
      {error && <p className="text-[10px]" style={{ color: 'var(--color-accent-red-hot)' }}>{error}</p>}

      {secretHistory.length > 0 && (
        <div>
          <h4 className="font-display text-[10px] mb-1" style={{ color: GOLD }}>Recent secret rolls</h4>
          <ul className="space-y-1">
            {secretHistory.map((h) => (
              <li key={h.id} className="text-[10px] font-ui truncate" style={{ color: 'var(--color-text-secondary)' }}>
                <span style={{ color: GOLD }}>{h.total}</span>
                {' · '}
                {h.label ?? h.notation}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
