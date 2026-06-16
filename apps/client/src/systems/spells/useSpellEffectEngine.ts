import { useEffect, useRef } from 'react';
import { useInitiativeStore } from '@/systems/map/store/initiativeStore';
import { hookInitiativeRound } from './concentrationManager';

/** Wires spell duration ticks to initiative round changes. */
export function useSpellEffectEngine(): void {
  const round = useInitiativeStore((s) => s.round);
  const prevRound = useRef(round);

  useEffect(() => {
    if (round !== prevRound.current) {
      hookInitiativeRound(round);
      prevRound.current = round;
    }
  }, [round]);
}
