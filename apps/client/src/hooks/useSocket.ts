import { useEffect, useRef } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { getSocket, connectSocket, isMobileClient } from '@/lib/socket';
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

/**
 * Establishes and manages the Socket.io connection for a session.
 * Handlers are always removed by reference — never socket.off('connect') without a fn.
 */
export function useSocket(
  sessionId: string | null,
  campaignId: string | null,
  retryNonce = 0,
) {
  const { isLoaded, isSignedIn, getToken } = useAuth();
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

    if (!isSignedIn) {
      setConnectionError('Sign in to join the live session');
      setConnected(false);
      return;
    }

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
        setConnectionError('Session join timed out — retrying…');
        setConnected(false);
        scheduleJoinRetry();
      }, JOIN_ACK_MS);
    }

    const joinRoom = () => {
      if (!socket.connected) return;
      joinedRef.current = false;
      socket.emit('session:join', { sessionId, campaignId });
      startJoinAckTimer();
    };

    function scheduleJoinRetry() {
      if (!alive || !socket.connected) return;
      if (joinRetryRef.current >= JOIN_RETRY_MAX) {
        setConnectionError('Could not join session — tap Retry or refresh');
        return;
      }
      joinedRef.current = false;
      const attempt = joinRetryRef.current;
      joinRetryRef.current += 1;
      const wait = isMobileClient() ? 2000 * (attempt + 1) : 1200 * (attempt + 1);
      joinRetryTimerRef.current = setTimeout(() => {
        joinRetryTimerRef.current = null;
        if (!alive || !socket.connected) return;
        clearConnectionError();
        joinRoom();
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
          clearJoinRetry();
          joinedRef.current = false;
          setConnected(false);
          if (reason === 'io server disconnect') {
            void socket.connect();
          }
        },
        onConnect: () => {
          clearConnectionError();
          joinRoom();
          bindFogActiveSocket();
          bindDdbRollSocket(true);
          syncFogActiveToSession();
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

    async function connect(attempt = 0): Promise<void> {
      const maxAttempts = isMobileClient() ? 8 : 5;
      try {
        clearConnectionError();
        const token = await getTokenRef.current({ skipCache: attempt > 0 });
        if (!alive) return;

        if (!token) {
          if (attempt < maxAttempts - 1) {
            await delay(isMobileClient() ? 2000 * (attempt + 1) : 1200 * (attempt + 1));
            return connect(attempt + 1);
          }
          setConnectionError('Sign-in expired — refresh and try again');
          setConnected(false);
          return;
        }

        attachHandlers();

        await connectSocket(token, { retries: isMobileClient() ? 6 : 3 });
        if (!alive) return;

        if (socket.connected) {
          joinRoom();
          syncFogActiveToSession();
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

    const onVisible = () => {
      if (document.visibilityState !== 'visible' || !alive) return;
      if (!socket.connected) {
        void connect();
      } else if (!joinedRef.current) {
        clearConnectionError();
        joinRoom();
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      alive = false;
      clearJoinRetry();
      clearJoinAckTimer();
      document.removeEventListener('visibilitychange', onVisible);
      if (joinedRef.current) {
        socket.emit('session:leave', { sessionId });
      }
      joinedRef.current = false;
      detachHandlers();
      setConnected(false);
    };
  }, [sessionId, campaignId, retryNonce, isLoaded, isSignedIn]);
}
