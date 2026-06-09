import { useEffect } from 'react';
import { useSessionStore } from '@/store/sessionStore';
import { bindDiceSocket, unbindDiceSocket } from './diceStore';

/** Subscribe to session dice rolls (call once on the session page). */
export function useDiceSocket(): void {
  const sessionId = useSessionStore((s) => s.sessionId);

  useEffect(() => {
    if (!sessionId) return;
    bindDiceSocket();
    return () => unbindDiceSocket();
  }, [sessionId]);
}
