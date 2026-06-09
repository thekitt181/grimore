import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import type { RollMode } from '@grimoire/dice-engine';
import type { ActionDamage, ActionRange } from '@/systems/compendium/statBlockParser';
import { useCombatStore } from './combatStore';
import { useDiceStore } from '@/systems/dice/diceStore';
import { RollOptionsMenu } from '@/systems/dice/RollOptionsMenu';

const GOLD = 'var(--color-accent-gold)';
const BD = 'var(--color-border)';
const HOLD_MS = 450;

interface TargetedAttackButtonProps {
  attackerTokenId: string;
  attackerName: string;
  actionName: string;
  toHit: number;
  damages?: ActionDamage[];
  range?: ActionRange;
  className?: string;
}

const ATTACK_STYLE: CSSProperties = {
  background: 'rgba(201,168,76,0.12)',
  border: `1px solid ${GOLD}`,
  color: GOLD,
};

export function TargetedAttackButton({
  attackerTokenId,
  attackerName,
  actionName,
  toHit,
  damages = [],
  range,
  className = '',
}: TargetedAttackButtonProps) {
  const beginAttack = useCombatStore((s) => s.beginTargetedAttack);
  const manualRollMode = useDiceStore((s) => s.rollMode);
  const btnRef = useRef<HTMLButtonElement>(null);
  const holdTimer = useRef<number | null>(null);
  const longPress = useRef(false);
  const [menuAnchor, setMenuAnchor] = useState<DOMRect | null>(null);

  const notation = `1d20${toHit >= 0 ? '+' : ''}${toHit}`;

  function clearHoldTimer() {
    if (holdTimer.current !== null) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  }

  function start(opts?: { rollMode?: RollMode; isSecret?: boolean }) {
    beginAttack({
      attackerTokenId,
      attackerName,
      actionName,
      toHit,
      damages,
      ...(range !== undefined ? { range } : {}),
      ...(opts?.rollMode !== undefined ? { rollMode: opts.rollMode } : {}),
      ...(opts?.isSecret !== undefined ? { isSecret: opts.isSecret } : {}),
    });
  }

  function onPointerDown(e: ReactPointerEvent<HTMLButtonElement>) {
    if (e.button !== 0) return;
    longPress.current = false;
    clearHoldTimer();
    holdTimer.current = window.setTimeout(() => {
      longPress.current = true;
      const rect = btnRef.current?.getBoundingClientRect();
      if (rect) setMenuAnchor(rect);
    }, HOLD_MS);
  }

  function onPointerUp(e: ReactPointerEvent<HTMLButtonElement>) {
    if (e.button !== 0) return;
    clearHoldTimer();
    if (!longPress.current) start();
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
        title={`${actionName} vs target · hold for adv/dis/secret`}
        className={`font-ui text-xs px-1.5 py-0.5 rounded transition-all hover:opacity-90 select-none touch-none ${className}`}
        style={ATTACK_STYLE}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerCancel}
        onPointerCancel={onPointerCancel}
        onContextMenu={(e) => e.preventDefault()}
      >
        To Hit {toHit >= 0 ? '+' : ''}{toHit}
        {manualRollMode === 'advantage' && <span className="ml-1 text-[9px] opacity-80">· Adv</span>}
        {manualRollMode === 'disadvantage' && <span className="ml-1 text-[9px] opacity-80">· Dis</span>}
      </button>
      {menuAnchor && (
        <RollOptionsMenu
          anchor={menuAnchor}
          notation={notation}
          label={actionName}
          showAdvantage
          onPick={(opts) => {
            start(opts);
            setMenuAnchor(null);
          }}
          onClose={() => setMenuAnchor(null)}
        />
      )}
    </>
  );
}
