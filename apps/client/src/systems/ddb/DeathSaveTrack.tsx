import type { GrimoireCharacter } from '@grimoire/shared';
import { rollDice } from '@grimoire/dice-engine';
import { useDiceStore } from '@/systems/dice/diceStore';
import {
  applyDeathSaveRoll,
  clearDeathSaves,
  normalizeDeathSaves,
  setDeathSaveCount,
  type DeathSavesState,
} from './deathSaveRoll';

const GOLD = 'var(--color-accent-gold)';
const BD = 'var(--color-border)';

function DeathSaveTag({ label }: { label: string }) {
  return (
    <span
      className="inline-block px-1.5 py-0.5 rounded text-[10px]"
      style={{
        background: 'rgba(74,222,128,0.12)',
        border: '1px solid rgba(74,222,128,0.35)',
        color: '#86efac',
      }}
    >
      {label}
    </span>
  );
}

function DeathSaveDots({
  label,
  count,
  tone,
  disabled,
  onSetCount,
}: {
  label: string;
  count: number;
  tone: 'success' | 'failure';
  disabled: boolean;
  onSetCount: (count: number) => void;
}) {
  const activeColor = tone === 'success' ? '#4ade80' : '#f87171';
  return (
    <span className="inline-flex items-center gap-1">
      {label}{' '}
      {[0, 1, 2].map((i) => {
        const filled = i < count;
        return (
          <button
            key={`${label}-${i}`}
            type="button"
            disabled={disabled}
            className="leading-none disabled:opacity-40 hover:opacity-100"
            style={{ color: filled ? activeColor : 'var(--color-text-secondary)' }}
            title={`Set ${label.toLowerCase()} to ${i + 1}`}
            onClick={() => onSetCount(i + 1)}
          >
            {filled ? '●' : '○'}
          </button>
        );
      })}
      <button
        type="button"
        disabled={disabled || count === 0}
        className="ml-0.5 opacity-50 hover:opacity-100 disabled:opacity-20 text-[9px]"
        title={`Clear ${label.toLowerCase()}`}
        onClick={() => onSetCount(0)}
      >
        ×
      </button>
    </span>
  );
}

export function DeathSaveTrack({
  deathSaves,
  characterName,
  syncEnabled,
  pending,
  onChange,
}: {
  deathSaves: GrimoireCharacter['deathSaves'];
  characterName: string;
  syncEnabled: boolean;
  pending: boolean;
  onChange: (deathSaves: DeathSavesState, hp?: number) => void;
}) {
  const rollMode = useDiceStore((s) => s.rollMode);
  const state = normalizeDeathSaves(deathSaves);
  const { successes, failures, stabilized } = state;
  const canRoll = !stabilized && successes < 3 && failures < 3;

  function applyChange(next: DeathSavesState, hp?: number) {
    onChange(normalizeDeathSaves(next), hp);
  }

  function handleRoll() {
    const result = rollDice('1d20', rollMode);
    let outcome: string;
    if (result.isCrit) outcome = 'Nat 20 — regain 1 HP';
    else if (result.isCritFail) outcome = 'Nat 1 — 2 failures';
    else if (result.total >= 10) outcome = `Success (${result.total})`;
    else outcome = `Failure (${result.total})`;

    useDiceStore.getState().performRoll('1d20', `${characterName} · death save — ${outcome}`, {
      rollMode,
      result,
    });

    const applied = applyDeathSaveRoll(state, result);
    applyChange(applied.deathSaves, applied.hp);
  }

  return (
    <div className="mt-2 space-y-1">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] opacity-70">Death saves</div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="shrink-0 rounded font-mono text-[10px] px-1.5 py-0 hover:opacity-100 opacity-85 disabled:opacity-40"
            style={{ background: 'rgba(201,168,76,0.15)', border: `1px solid ${BD}`, color: GOLD }}
            title="Roll death save (d20, 10+ success)"
            disabled={!canRoll || pending}
            onClick={handleRoll}
          >
            Roll d20
          </button>
          <button
            type="button"
            className="text-[10px] opacity-60 hover:opacity-100 disabled:opacity-30"
            title="Clear death saves"
            disabled={pending || (successes === 0 && failures === 0 && !stabilized)}
            onClick={() => applyChange(clearDeathSaves())}
          >
            Reset
          </button>
        </div>
      </div>
      {!syncEnabled && (
        <div className="text-[9px] opacity-50">Enable Push HP on token to sync death saves to DDB.</div>
      )}
      <div className="flex flex-wrap gap-3 items-center text-[10px]">
        <DeathSaveDots
          label="Successes"
          count={successes}
          tone="success"
          disabled={pending}
          onSetCount={(count) => applyChange(setDeathSaveCount(state, 'successes', count))}
        />
        <DeathSaveDots
          label="Failures"
          count={failures}
          tone="failure"
          disabled={pending}
          onSetCount={(count) => applyChange(setDeathSaveCount(state, 'failures', count))}
        />
        {stabilized && <DeathSaveTag label="Stabilized" />}
        {successes === 0 && failures === 0 && !stabilized && (
          <span className="opacity-50">None</span>
        )}
      </div>
    </div>
  );
}
