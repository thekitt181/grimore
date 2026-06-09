import { useCallback, useEffect, useRef } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { getSocket, connectSocket } from '@/lib/socket';
import { useSessionStore } from '@/store/sessionStore';
import { useChatStore } from '@/store/chatStore';
import { bindFogActiveSocket, emitFogActive } from '@/systems/scene/fogActiveSync';
import { useMapStore } from '@/systems/map/store/mapStore';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Establishes and manages the Socket.io connection for a session.
 * Handles authentication, room events, and cleanup on unmount.
 */
export function useSocket(
  sessionId: string | null,
  campaignId: string | null,
  retryNonce = 0,
) {
  const { getToken } = useAuth();
  const {
    setConnected,
    addUser,
    removeUser,
    setConnectedUsers,
    setConnectionError,
    clearConnectionError,
  } = useSessionStore();
  const { addMessage } = useChatStore();
  const setupGen = useRef(0);

  const attachListeners = useCallback((sid: string) => {
    const socket = getSocket();

    socket.off('session:roomState');
    socket.off('session:userJoined');
    socket.off('session:userLeft');
    socket.off('chat:message');
    socket.off('error');
    socket.off('disconnect');
    socket.off('connect');

    socket.emit('session:join', { sessionId: sid, campaignId: campaignId! });

    socket.on('session:roomState', ({ users }) => {
      setConnectedUsers(users);
    });

    socket.on('session:userJoined', ({ user }) => {
      addUser(user);
    });

    socket.on('session:userLeft', ({ userId }) => {
      removeUser(userId);
    });

    socket.on('chat:message', (payload) => {
      addMessage(payload);
    });

    socket.on('error', ({ message }) => {
      console.error('[Socket] Error:', message);
      setConnectionError(message);
    });

    socket.on('disconnect', () => {
      setConnected(false);
    });

    socket.on('connect', () => {
      clearConnectionError();
      setConnected(true);
      socket.emit('session:join', { sessionId: sid, campaignId: campaignId! });
    });

    bindFogActiveSocket();

    if (useSessionStore.getState().myRole === 'GM') {
      emitFogActive(useMapStore.getState().fogEnabled);
    }
  }, [campaignId, addUser, removeUser, setConnectedUsers, addMessage, setConnected, setConnectionError, clearConnectionError]);

  useEffect(() => {
    if (!sessionId || !campaignId) return;

    const gen = ++setupGen.current;
    let cancelled = false;

    async function setup(attempt = 0): Promise<void> {
      const maxAttempts = 5;
      try {
        clearConnectionError();
        const token = await getToken({ skipCache: attempt > 0 });
        if (!token) {
          if (attempt < maxAttempts - 1 && !cancelled && gen === setupGen.current) {
            await delay(1200 * (attempt + 1));
            return setup(attempt + 1);
          }
          if (!cancelled && gen === setupGen.current) {
            setConnectionError('Sign-in expired — refresh and try again');
          }
          return;
        }

        if (cancelled || gen !== setupGen.current) return;

        await connectSocket(token, { retries: 3 });
        if (cancelled || gen !== setupGen.current) return;

        setConnected(true);
        attachListeners(sessionId!);
      } catch (err) {
        console.error('[Socket] Setup failed:', err);
        if (cancelled || gen !== setupGen.current) return;

        if (attempt < maxAttempts - 1) {
          await delay(1500 * (attempt + 1));
          return setup(attempt + 1);
        }

        const msg = err instanceof Error ? err.message : 'Connection failed';
        setConnectionError(msg);
        setConnected(false);
      }
    }

    void setup();

    return () => {
      cancelled = true;
      const socket = getSocket();
      if (sessionId) {
        socket.emit('session:leave', { sessionId });
      }
      socket.off('session:roomState');
      socket.off('session:userJoined');
      socket.off('session:userLeft');
      socket.off('chat:message');
      socket.off('error');
      socket.off('disconnect');
      socket.off('connect');
      setConnected(false);
    };
  }, [sessionId, campaignId, retryNonce, getToken, setConnected, attachListeners, setConnectionError, clearConnectionError]);
}
