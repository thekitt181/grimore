import { useState, useRef, useEffect, useMemo } from 'react';
import { formatDiceNotation, parseSimpleDiceNotation } from '@grimoire/dice-engine';
import { DraggablePanel } from '@/components/DraggablePanel';
import { ddbPanelPosition, ddbPanelWidth } from '@/systems/ddb/ddbTokenUtils';
import { isMobileClient } from '@/lib/socket';
import { useSessionStore } from '@/store/sessionStore';
import { useDiceStore } from './diceStore';
import type { RollMode } from '@grimoire/dice-engine';

const DICE = [4, 6, 8, 10, 12, 20, 100];

function DiceStepper({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
}) {
  const [text, setText] = useState(String(value));
  const GOLD = 'var(--color-accent-gold)';
  const BD = 'var(--color-border)';

  useEffect(() => {
    setText(String(value));
  }, [value]);

  function commit(raw: string) {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n)) {
      onChange(Math.min(max, Math.max(min, n)));
    } else {
      setText(String(value));
    }
  }

  return (
    <div className="flex items-center gap-1 flex-1 min-w-0">
      <span className="font-ui text-[10px] shrink-0 w-7" style={{ color: 'var(--color-text-secondary)' }}>{label}</span>
      <button
        type="button"
        className="w-6 h-6 rounded text-xs shrink-0"
        style={{ border: `1px solid ${BD}`, color: GOLD }}
        onClick={() => onChange(Math.max(min, value - 1))}
      >
        −
      </button>
      <input
        type="text"
        inputMode="numeric"
        className="input-stat !w-11 !min-w-[2.75rem] !px-1 !py-0.5"
        value={text}
        onChange={(e) => {
          const next = e.target.value;
          if (/^-?\d*$/.test(next)) setText(next);
        }}
        onBlur={() => commit(text)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
      <button
        type="button"
        className="w-6 h-6 rounded text-xs shrink-0"
        style={{ border: `1px solid ${BD}`, color: GOLD }}
        onClick={() => onChange(Math.min(max, value + 1))}
      >
        +
      </button>
    </div>
  );
}

export function DiceRoller({ onClose }: { onClose: () => void }) {
  const [count, setCount] = useState(1);
  const [modifier, setModifier] = useState(0);
  const [sides, setSides] = useState(20);
  const [expr, setExpr] = useState('1d20');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const histRef = useRef<HTMLDivElement>(null);

  const history = useDiceStore((s) => s.history);
  const isSecret = useDiceStore((s) => s.isSecret);
  const rollMode = useDiceStore((s) => s.rollMode);
  const setIsSecret = useDiceStore((s) => s.setIsSecret);
  const setRollMode = useDiceStore((s) => s.setRollMode);
  const performRoll = useDiceStore((s) => s.performRoll);
  const { myRole } = useSessionStore();

  const builtExpr = useMemo(() => formatDiceNotation(count, sides, modifier), [count, sides, modifier]);

  useEffect(() => {
    histRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [history.length]);

  useEffect(() => {
    if (sides === 20 && count === 1) return;
    if (rollMode !== 'normal') setRollMode('normal');
  }, [count, sides, rollMode, setRollMode]);

  function applyBuilder(next: { count?: number; sides?: number; modifier?: number }) {
    const c = next.count ?? count;
    const s = next.sides ?? sides;
    const m = next.modifier ?? modifier;
    if (next.count !== undefined) setCount(c);
    if (next.sides !== undefined) setSides(s);
    if (next.modifier !== undefined) setModifier(m);
    setExpr(formatDiceNotation(c, s, m));
  }

  function syncFromExpr(expression: string) {
    const parsed = parseSimpleDiceNotation(expression);
    if (parsed) {
      setCount(parsed.count);
      setSides(parsed.sides);
      setModifier(parsed.modifier);
    }
  }

  function roll(expression: string) {
    setError('');
    const result = performRoll(expression);
    if (!result) {
      setError('Invalid expression. Try "2d6+3" or "1d20+5".');
    }
  }

  function rollBuilt(dieSides: number) {
    const notation = formatDiceNotation(count, dieSides, modifier);
    applyBuilder({ sides: dieSides });
    roll(notation);
  }

  const GOLD = 'var(--color-accent-gold)';
  const BD = 'var(--color-border)';

  return (
    <DraggablePanel
      title="🎲 Dice Roller"
      onClose={onClose}
      defaultPosition={
        isMobileClient()
          ? ddbPanelPosition(10, 56)
          : { x: Math.max(16, window.innerWidth - 300), y: Math.max(16, window.innerHeight - 640) }
      }
      width={ddbPanelWidth(280)}
      maxHeight={isMobileClient() ? 'calc(100vh - 9rem)' : '600px'}
      zIndex={150}
    >
      <div className="select-none">
      <div className="flex gap-2 px-2 py-2 shrink-0" style={{ borderBottom: `1px solid ${BD}` }}>
        <DiceStepper label="#" value={count} min={1} max={20} onChange={(n) => applyBuilder({ count: n })} />
        <DiceStepper label="±" value={modifier} min={-99} max={99} onChange={(n) => applyBuilder({ modifier: n })} />
      </div>

      <p className="font-ui text-[10px] text-center py-1 shrink-0" style={{ color: 'var(--color-text-secondary)', borderBottom: `1px solid ${BD}` }}>
        Quick roll: <span style={{ color: GOLD }}>{builtExpr}</span>
      </p>

      <div className="grid grid-cols-4 gap-1 p-2 shrink-0" style={{ borderBottom: `1px solid ${BD}` }}>
        {DICE.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => rollBuilt(d)}
            className="py-1.5 rounded font-display text-xs transition-all"
            style={{
              background: sides === d ? 'rgba(201,168,76,0.15)' : 'var(--color-bg-tertiary)',
              border: `1px solid ${sides === d ? GOLD : BD}`,
              color: GOLD,
            }}
          >
            d{d}
          </button>
        ))}
      </div>

      <div className="flex gap-1 px-2 py-2 shrink-0" style={{ borderBottom: `1px solid ${BD}` }}>
        <input
          ref={inputRef}
          value={expr}
          onChange={(e) => {
            setExpr(e.target.value);
            syncFromExpr(e.target.value);
          }}
          onKeyDown={(e) => { if (e.key === 'Enter') roll(expr); }}
          placeholder="e.g. 2d6+3"
          className="input-dark text-xs py-1 flex-1"
        />
        <button type="button" onClick={() => roll(expr)} className="btn-primary text-xs px-3 py-1">
          Roll
        </button>
      </div>

      <div className="flex gap-1 px-2 py-1.5 shrink-0" style={{ borderBottom: `1px solid ${BD}` }}>
        {(['normal', 'advantage', 'disadvantage'] as RollMode[]).map((mode) => {
          const disabled = mode !== 'normal' && (sides !== 20 || count !== 1);
          return (
            <button
              key={mode}
              type="button"
              disabled={disabled}
              onClick={() => setRollMode(mode)}
              className="flex-1 text-[10px] py-1 rounded font-ui capitalize"
              style={{
                background: rollMode === mode ? 'rgba(201,168,76,0.2)' : 'var(--color-bg-tertiary)',
                border: `1px solid ${rollMode === mode ? GOLD : BD}`,
                color: rollMode === mode ? GOLD : 'var(--color-text-secondary)',
                opacity: disabled ? 0.35 : 1,
              }}
              title={disabled ? 'Advantage/disadvantage only for 1d20' : undefined}
            >
              {mode === 'normal' ? 'Normal' : mode === 'advantage' ? 'Adv' : 'Dis'}
            </button>
          );
        })}
      </div>

      {myRole === 'GM' && (
        <div className="flex items-center gap-2 px-3 py-1.5 shrink-0" style={{ borderBottom: `1px solid ${BD}` }}>
          <input
            type="checkbox"
            id="secret-roll"
            checked={isSecret}
            onChange={(e) => setIsSecret(e.target.checked)}
            className="accent-[#c9a84c]"
          />
          <label htmlFor="secret-roll" className="font-ui text-xs cursor-pointer" style={{ color: 'var(--color-text-secondary)' }}>
            Secret roll (GM only)
          </label>
        </div>
      )}

      {error && (
        <p className="font-ui text-xs px-3 py-1 shrink-0" style={{ color: 'var(--color-accent-red-hot)' }}>{error}</p>
      )}

      <div ref={histRef} className="overflow-y-auto flex-1 px-2 py-1 space-y-1" style={{ minHeight: 80 }}>
        {history.length === 0 && (
          <p className="font-ui text-xs text-center py-4" style={{ color: 'var(--color-text-secondary)' }}>
            No rolls yet. Roll the dice!
          </p>
        )}
        {history.map((h) => (
          <div
            key={h.id}
            className="rounded px-2 py-1.5"
            style={{
              background: h.isCrit ? 'rgba(201,168,76,0.15)'
                : h.isCritFail ? 'rgba(239,68,68,0.1)'
                : 'var(--color-bg-tertiary)',
              border: `1px solid ${h.isCrit ? GOLD : h.isCritFail ? '#ef4444' : BD}`,
            }}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-ui text-xs truncate" style={{ color: 'var(--color-text-secondary)' }}>
                {h.rollerName}
                {h.isSecret && ' 🔒'}
                {h.secretHidden && ' (hidden)'}
              </span>
              <span
                className="font-display text-base font-bold shrink-0"
                style={{ color: h.isCrit ? GOLD : h.isCritFail ? '#ef4444' : 'var(--color-text-primary)' }}
              >
                {h.secretHidden ? '—' : h.total}
                {h.isCrit && ' ★'}
                {h.isCritFail && ' ✗'}
              </span>
            </div>
            <div className="font-ui text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
              <span style={{ color: GOLD }}>{h.notation}</span>
              {!h.secretHidden && (
                <>
                  {' → '}
                  [{h.results.map((v) => {
                    const dropped = h.droppedResults.includes(v) && h.rollMode !== 'normal';
                    return dropped ? `~~${v}~~` : String(v);
                  }).join(', ')}]
                  {h.rollMode !== 'normal' && (
                    <span className="ml-1 opacity-70">({h.rollMode})</span>
                  )}
                </>
              )}
            </div>
          </div>
        ))}
      </div>
      </div>
    </DraggablePanel>
  );
}
