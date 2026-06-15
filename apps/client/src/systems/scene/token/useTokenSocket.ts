import { useEffect } from 'react';
import { getSocket } from '@/lib/socket';
import { applyTokenSocketPatch } from '@/systems/scene/token/tokenSync';

const TOKEN_EVENTS = [
  'token:place',
  'token:move',
  'token:hp',
  'token:type',
  'token:rotate',
  'token:hide',
  'token:delete',
  'token:condition',
] as const;

/** Listen for granular token:* socket events from other clients. */
export function useTokenSocket(sessionId: string | null) {
  useEffect(() => {
    if (!sessionId) return;
    const socket = getSocket();

    const handlers = TOKEN_EVENTS.map((event) => {
      const handler = (payload: Record<string, unknown> & { sessionId?: string }) => {
        if (payload.sessionId !== sessionId) return;
        applyTokenSocketPatch(event, payload);
      };
      socket.on(event, handler as any);
      return { event, handler };
    });

    return () => {
      for (const { event, handler } of handlers) {
        socket.off(event, handler as any);
      }
    };
  }, [sessionId]);
}
