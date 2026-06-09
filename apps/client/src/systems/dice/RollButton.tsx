import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { isD20Notation } from '@grimoire/dice-engine';
import type { RollMode } from '@grimoire/dice-engine';
import { useDiceStore } from './diceStore';
import { RollOptionsMenu } from './RollOptionsMenu';

const GOLD = 'var(--color-accent-gold)';
const BD = 'var(--color-border)';
const HOLD_MS = 450;

interface RollButtonProps {
  notation: string;
  label: string;
  title?: string;
  variant?: 'default' | 'attack' | 'damage' | 'save' | 'spell';
  className?: string;
}

const VARIANT_STYLES: Record<NonNullable<RollButtonProps['variant']>, CSSProperties> = {
  default: {
    background: 'var(--color-bg-tertiary)',
    border: `1px solid ${BD}`,
    color: GOLD,
  },
  attack: {
    background: 'rgba(201,168,76,0.12)',
    border: `1px solid ${GOLD}`,
    color: GOLD,
  },
  damage: {
    background: 'rgba(239,68,68,0.1)',
    border: '1px solid #ef4444',
    color: '#fca5a5',
  },
  save: {
    background: 'transparent',
    border: '1px solid #ef4444',
    color: '#fca5a5',
  },
  spell: {
    background: 'rgba(96,165,250,0.12)',
    border: '1px solid #60a5fa',
    color: '#93c5fd',
  },
};

export function RollButton({ notation, label, title, variant = 'default', className = '' }: RollButtonProps) {
  const performRoll = useDiceStore((s) => s.performRoll);
  const defaultRollMode = useDiceStore((s) => s.rollMode);
  const btnRef = useRef<HTMLButtonElement>(null);
  const holdTimer = useRef<number | null>(null);
  const longPress = useRef(false);
  const [menuAnchor, setMenuAnchor] = useState<DOMRect | null>(null);

  function clearHoldTimer() {
    if (holdTimer.current !== null) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  }

  function roll(opts?: { rollMode?: RollMode; isSecret?: boolean }) {
    const isD20 = isD20Notation(notation);
    performRoll(notation, label, {
      rollMode: opts?.rollMode ?? (isD20 ? defaultRollMode : 'normal'),
      isSecret: opts?.isSecret ?? false,
    });
  }

  function openMenu() {
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) setMenuAnchor(rect);
  }

  function onPointerDown(e: ReactPointerEvent<HTMLButtonElement>) {
    if (e.button !== 0) return;
    longPress.current = false;
    clearHoldTimer();
    holdTimer.current = window.setTimeout(() => {
      longPress.current = true;
      openMenu();
    }, HOLD_MS);
  }

  function onPointerUp(e: ReactPointerEvent<HTMLButtonElement>) {
    if (e.button !== 0) return;
    clearHoldTimer();
    if (!longPress.current) {
      roll();
    }
    longPress.current = false;
  }

  function onPointerCancel() {
    clearHoldTimer();
    longPress.current = false;
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        title={title ?? `Roll ${notation} · hold for options`}
        className={`font-ui text-xs px-1.5 py-0.5 rounded transition-all hover:opacity-90 select-none touch-none ${className}`}
        style={VARIANT_STYLES[variant]}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerCancel}
        onPointerCancel={onPointerCancel}
        onContextMenu={(e) => e.preventDefault()}
      >
        {label}
      </button>
      {menuAnchor && (
        <RollOptionsMenu
          anchor={menuAnchor}
          notation={notation}
          label={label}
          showAdvantage={isD20Notation(notation)}
          onPick={(opts) => {
            roll(opts);
            setMenuAnchor(null);
          }}
          onClose={() => setMenuAnchor(null)}
        />
      )}
    </>
  );
}
