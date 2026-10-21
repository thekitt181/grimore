import { useEffect } from 'react';
import { getSocket } from '@/lib/socket';
import { applyTokenSocketPatch } from '@/systems/scene/token/tokenSync';

/**
 * Granular token:* events — token:live + token:rotate share this path so mid-walk
 * is applied exactly like look-around (survives reconnect via rebind on connect).
 */
const TOKEN_EVENTS = [
  'token:place',
  'token:move',
  'token:live',
  'map:tokenMove',
  'token:hp',
  'token:type',
  'token:rotate',
  'token:hide',
  'token:delete',
  'token:condition',
] as const;

type Handler = (payload: Record<string, unknown> & { sessionId?: string }) => void;

/** Listen for granular token:* socket events from other clients. */
export function useTokenSocket(sessionId: string | null) {
  useEffect(() => {
    if (!sessionId) return;
    const socket = getSocket();
    const bound: Array<{ event: (typeof TOKEN_EVENTS)[number]; handler: Handler }> = [];

    const clearBound = () => {
      for (const { event, handler } of bound) {
        socket.off(event, handler as any);
      }
      bound.length = 0;
    };

    const bind = () => {
      clearBound();
      for (const event of TOKEN_EVENTS) {
        const handler: Handler = (payload) => {
          if (payload.sessionId !== sessionId) return;
          applyTokenSocketPatch(event, payload);
        };
        socket.on(event, handler as any);
        bound.push({ event, handler });
      }
    };

    bind();
    socket.on('connect', bind);

    return () => {
      socket.off('connect', bind);
      clearBound();
    };
  }, [sessionId]);
}
