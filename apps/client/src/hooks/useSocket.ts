import { useEffect, useRef } from 'react';
import { useGrimoireAuth } from '@/hooks/useGrimoireAuth';
import {
  configureSocketSession,
  connectSocket,
  getSocket,
  isMobileClient,
  reconnectSocketWithFreshAuth,
} from '@/lib/socket';
import { useSessionStore } from '@/store/sessionStore';
import { useChatStore } from '@/store/chatStore';
import { applySessionFogActive, bindFogActiveSocket, syncFogActiveToSession } from '@/systems/scene/fogActiveSync';
import { bindDdbRollSocket } from '@/systems/ddb/bindDdbRollSocket';
import type { ChatMessagePayload } from '@grimoire/shared';
import type { SessionUser } from '@grimoire/shared';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type SocketHandlers = {
  onRoomState: (payload: { users: SessionUser[]; fogActive?: boolean }) => void;
  onUserJoined: (payload: { user: SessionUser }) => void;
  onUserLeft: (payload: { userId: string }) => void;
  onChat: (payload: ChatMessagePayload) => void;
  onError: (payload: { message: string }) => void;
  onDisconnect: (reason: string) => void;
  onConnect: () => void;
  onConnectError: (err: Error) => void;
  onReconnectFailed: () => void;
};

const JOIN_RETRY_MAX = 8;
const JOIN_ACK_MS = isMobileClient() ? 22_000 : 15_000;
const TOKEN_REFRESH_MS = 8 * 60_000;

/**
 * Establishes and manages the Socket.io connection for a session.
 * Handlers are always removed by reference — never socket.off('connect') without a fn.
 */
export function useSocket(
  sessionId: string | null,
  campaignId: string | null,
  retryNonce = 0,
) {
  const { isLoaded, getToken } = useGrimoireAuth();
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  const handlersRef = useRef<SocketHandlers | null>(null);
  const joinedRef = useRef(false);
  const joinRetryRef = useRef(0);
  const joinRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const joinAckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!sessionId || !campaignId || !isLoaded) return;

    const {
      setConnected,
      setConnectedUsers,
      addUser,
      removeUser,
      setConnectionError,
      clearConnectionError,
    } = useSessionStore.getState();
    const { addMessage } = useChatStore.getState();

    let alive = true;
    const socket = getSocket();

    function clearJoinAckTimer() {
      if (joinAckTimerRef.current) {
        clearTimeout(joinAckTimerRef.current);
        joinAckTimerRef.current = null;
      }
    }

    function clearJoinRetry() {
      if (joinRetryTimerRef.current) {
        clearTimeout(joinRetryTimerRef.current);
        joinRetryTimerRef.current = null;
      }
      joinRetryRef.current = 0;
    }

    function startJoinAckTimer() {
      clearJoinAckTimer();
      joinAckTimerRef.current = setTimeout(() => {
        joinAckTimerRef.current = null;
        if (!alive || joinedRef.current) return;
        console.warn('[Socket] session:join ack timed out');
        setConnectionError('Reconnecting to session…');
        setConnected(false);
        scheduleJoinRetry(true);
      }, JOIN_ACK_MS);
    }

    const joinRoom = () => {
      if (!socket.connected) return;
      joinedRef.current = false;
      socket.emit('session:join', { sessionId, campaignId });
      startJoinAckTimer();
    };

    function afterTransportUp() {
      clearConnectionError();
      joinRoom();
      bindFogActiveSocket();
      bindDdbRollSocket(true);
      syncFogActiveToSession();
    }

    async function scheduleJoinRetry(forceFreshAuth = false) {
      if (!alive) return;
      if (joinRetryRef.current >= JOIN_RETRY_MAX) {
        setConnectionError('Could not stay connected — tap Retry');
        return;
      }
      joinedRef.current = false;
      const attempt = joinRetryRef.current;
      joinRetryRef.current += 1;
      const wait = isMobileClient() ? 1500 * (attempt + 1) : 900 * (attempt + 1);
      joinRetryTimerRef.current = setTimeout(() => {
        joinRetryTimerRef.current = null;
        if (!alive) return;
        void (async () => {
          try {
            clearConnectionError();
            if (forceFreshAuth || !socket.connected) {
              await reconnectSocketWithFreshAuth();
            } else if (socket.connected) {
              joinRoom();
            }
          } catch (err) {
            console.warn('[Socket] Rejoin failed:', err);
            if (alive && attempt < JOIN_RETRY_MAX - 1) {
              scheduleJoinRetry(true);
            } else {
              setConnectionError('Lost connection — tap Retry');
            }
          }
        })();
      }, wait);
    }

    function detachHandlers() {
      const h = handlersRef.current;
      if (!h) return;
      socket.off('session:roomState', h.onRoomState);
      socket.off('session:userJoined', h.onUserJoined);
      socket.off('session:userLeft', h.onUserLeft);
      socket.off('chat:message', h.onChat);
      socket.off('error', h.onError);
      socket.off('disconnect', h.onDisconnect);
      socket.off('connect', h.onConnect);
      socket.off('connect_error', h.onConnectError);
      socket.io.off('reconnect_failed', h.onReconnectFailed);
      handlersRef.current = null;
    }

    function attachHandlers() {
      detachHandlers();

      const h: SocketHandlers = {
        onRoomState: ({ users, fogActive }) => {
          clearJoinAckTimer();
          clearJoinRetry();
          joinedRef.current = true;
          setConnectedUsers(users);
          setConnected(true);
          clearConnectionError();
          if (typeof fogActive === 'boolean') {
            applySessionFogActive(fogActive);
          }
        },
        onUserJoined: ({ user }) => addUser(user),
        onUserLeft: ({ userId }) => removeUser(userId),
        onChat: (payload) => addMessage(payload),
        onError: ({ message }) => {
          console.error('[Socket] Error:', message);
          clearJoinAckTimer();
          if (message.includes('Authentication failed') || message.includes('auth')) {
            void scheduleJoinRetry(true);
            return;
          }
          setConnectionError(message);
          setConnected(false);
          joinedRef.current = false;
          if (
            message.includes('join session')
            || message.includes('member of this campaign')
          ) {
            scheduleJoinRetry();
          }
        },
        onDisconnect: (reason) => {
          clearJoinAckTimer();
          joinedRef.current = false;
          setConnected(false);
          clearConnectionError();
          console.warn('[Socket] disconnected:', reason);
          if (reason === 'io server disconnect') {
            void reconnectSocketWithFreshAuth().catch(() => scheduleJoinRetry(true));
          }
        },
        onConnect: () => {
          afterTransportUp();
        },
        onConnectError: (err) => {
          console.warn('[Socket] connect_error:', err.message);
        },
        onReconnectFailed: () => {
          setConnectionError('Lost connection to server — tap Retry');
          setConnected(false);
          joinedRef.current = false;
        },
      };

      handlersRef.current = h;
      socket.on('session:roomState', h.onRoomState);
      socket.on('session:userJoined', h.onUserJoined);
      socket.on('session:userLeft', h.onUserLeft);
      socket.on('chat:message', h.onChat);
      socket.on('error', h.onError);
      socket.on('disconnect', h.onDisconnect);
      socket.on('connect', h.onConnect);
      socket.on('connect_error', h.onConnectError);
      socket.io.on('reconnect_failed', h.onReconnectFailed);

      bindFogActiveSocket();
      bindDdbRollSocket(true);
    }

    configureSocketSession({
      getAuthToken: () => getTokenRef.current({ skipCache: true }),
      onReconnected: () => {
        if (!alive) return;
        afterTransportUp();
      },
    });

    async function connect(attempt = 0): Promise<void> {
      const maxAttempts = isMobileClient() ? 8 : 5;
      try {
        const token = await getTokenRef.current({ skipCache: attempt > 0 });
        if (!alive) return;

        if (!token) {
          if (attempt < maxAttempts - 1) {
            await delay(isMobileClient() ? 2000 * (attempt + 1) : 1200 * (attempt + 1));
            return connect(attempt + 1);
          }
          setConnectionError('Sign in to join the live session');
          setConnected(false);
          return;
        }

        attachHandlers();

        await connectSocket(token, { retries: isMobileClient() ? 6 : 3 });
        if (!alive) return;

        if (socket.connected) {
          afterTransportUp();
        }
        window.dispatchEvent(new CustomEvent('grimoire:socket-connected'));
      } catch (err) {
        console.error('[Socket] Setup failed:', err);
        if (!alive) return;

        if (attempt < maxAttempts - 1) {
          await delay(isMobileClient() ? 2500 * (attempt + 1) : 1500 * (attempt + 1));
          return connect(attempt + 1);
        }

        const msg = err instanceof Error ? err.message : 'Connection failed';
        setConnectionError(msg);
        setConnected(false);
      }
    }

    joinedRef.current = false;
    clearJoinRetry();
    clearJoinAckTimer();
    void connect();

    const tokenRefreshInterval = window.setInterval(() => {
      if (!alive || !socket.connected) return;
      void getTokenRef.current({ skipCache: true }).then((token) => {
        if (token) socket.auth = { token };
      });
    }, TOKEN_REFRESH_MS);

    const onVisible = () => {
      if (document.visibilityState !== 'visible' || !alive) return;
      if (!socket.connected) {
        void reconnectSocketWithFreshAuth()
          .then(() => afterTransportUp())
          .catch(() => void connect());
      } else if (!joinedRef.current) {
        afterTransportUp();
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    const onOnline = () => {
      if (!alive) return;
      if (!socket.connected || !joinedRef.current) {
        void reconnectSocketWithFreshAuth()
          .then(() => afterTransportUp())
          .catch(() => scheduleJoinRetry(true));
      }
    };
    window.addEventListener('online', onOnline);

    return () => {
      alive = false;
      configureSocketSession(null);
      clearJoinRetry();
      clearJoinAckTimer();
      window.clearInterval(tokenRefreshInterval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      if (joinedRef.current) {
        socket.emit('session:leave', { sessionId });
      }
      joinedRef.current = false;
      detachHandlers();
      // Avoid flashing "Connecting" when Clerk/React re-runs the same session effect.
      const stillSameSession =
        useSessionStore.getState().sessionId === sessionId
        && useSessionStore.getState().campaignId === campaignId;
      if (!stillSameSession) {
        setConnected(false);
      }
    };
  }, [sessionId, campaignId, retryNonce, isLoaded]);
}
