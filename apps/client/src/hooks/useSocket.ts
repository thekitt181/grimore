import { useCallback, useEffect, useRef } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { getSocket, connectSocket, isMobileClient } from '@/lib/socket';
import { useSessionStore } from '@/store/sessionStore';
import { useChatStore } from '@/store/chatStore';
import { applySessionFogActive, bindFogActiveSocket, syncFogActiveToSession } from '@/systems/scene/fogActiveSync';
import { bindDdbRollSocket } from '@/systems/ddb/bindDdbRollSocket';

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
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

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
  const joinedRef = useRef(false);

  const attachListeners = useCallback((sid: string) => {
    const socket = getSocket();

    socket.off('session:roomState');
    socket.off('session:userJoined');
    socket.off('session:userLeft');
    socket.off('chat:message');
    socket.off('error');
    socket.off('disconnect');
    socket.off('connect');

    const joinRoom = () => {
      if (!campaignId) return;
      socket.emit('session:join', { sessionId: sid, campaignId });
      joinedRef.current = true;
    };

    socket.on('session:roomState', ({ users, fogActive }) => {
      setConnectedUsers(users);
      setConnected(true);
      clearConnectionError();
      if (typeof fogActive === 'boolean') {
        applySessionFogActive(fogActive);
      }
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
      setConnected(false);
    });

    socket.on('disconnect', (reason) => {
      joinedRef.current = false;
      setConnected(false);
      if (reason === 'io server disconnect') {
        void socket.connect();
      }
    });

    socket.on('connect', () => {
      clearConnectionError();
      setConnected(true);
      joinRoom();
      bindFogActiveSocket();
      bindDdbRollSocket(true);
      syncFogActiveToSession();
    });

    // Register handlers before join so we never miss the initial room snapshot.
    bindFogActiveSocket();
    bindDdbRollSocket(true);
    joinRoom();
    syncFogActiveToSession();
  }, [campaignId, addUser, removeUser, setConnectedUsers, addMessage, setConnected, setConnectionError, clearConnectionError]);

  useEffect(() => {
    if (!sessionId || !campaignId || !isLoaded) return;
    if (!isSignedIn) {
      setConnectionError('Sign in to join the live session');
      setConnected(false);
      return;
    }

    const gen = ++setupGen.current;
    let cancelled = false;
    joinedRef.current = false;

    async function setup(attempt = 0): Promise<void> {
      const maxAttempts = isMobileClient() ? 10 : 5;
      try {
        clearConnectionError();
        const token = await getTokenRef.current({ skipCache: attempt > 0 });
        if (!token) {
          if (attempt < maxAttempts - 1 && !cancelled && gen === setupGen.current) {
            await delay(isMobileClient() ? 2000 * (attempt + 1) : 1200 * (attempt + 1));
            return setup(attempt + 1);
          }
          if (!cancelled && gen === setupGen.current) {
            setConnectionError('Sign-in expired — refresh and try again');
          }
          return;
        }

        if (cancelled || gen !== setupGen.current) return;

        await connectSocket(token, { retries: isMobileClient() ? 8 : 3 });
        if (cancelled || gen !== setupGen.current) return;

        setConnected(true);
        attachListeners(sessionId!);
        window.dispatchEvent(new CustomEvent('grimoire:socket-connected'));
      } catch (err) {
        console.error('[Socket] Setup failed:', err);
        if (cancelled || gen !== setupGen.current) return;

        if (attempt < maxAttempts - 1) {
          await delay(isMobileClient() ? 2500 * (attempt + 1) : 1500 * (attempt + 1));
          return setup(attempt + 1);
        }

        const msg = err instanceof Error ? err.message : 'Connection failed';
        setConnectionError(msg);
        setConnected(false);
      }
    }

    void setup();

    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (!sessionId || !campaignId) return;
      const socket = getSocket();
      if (!socket.connected) {
        void setup();
      } else if (!joinedRef.current) {
        attachListeners(sessionId);
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      const socket = getSocket();
      if (sessionId && joinedRef.current) {
        socket.emit('session:leave', { sessionId });
      }
      joinedRef.current = false;
      socket.off('session:roomState');
      socket.off('session:userJoined');
      socket.off('session:userLeft');
      socket.off('chat:message');
      socket.off('error');
      socket.off('disconnect');
      socket.off('connect');
      setConnected(false);
    };
  }, [sessionId, campaignId, retryNonce, isLoaded, isSignedIn, setConnected, attachListeners, setConnectionError, clearConnectionError]);
}
