import { useEffect, useRef } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { getSocket, connectSocket, disconnectSocket } from '@/lib/socket';
import { useSessionStore } from '@/store/sessionStore';
import { useChatStore } from '@/store/chatStore';

/**
 * Establishes and manages the Socket.io connection for a session.
 * Handles authentication, room events, and cleanup on unmount.
 */
export function useSocket(sessionId: string | null, campaignId: string | null) {
  const { getToken } = useAuth();
  const { setConnected, addUser, removeUser, setConnectedUsers, setMyRole } = useSessionStore();
  const { addMessage } = useChatStore();
  const isSetup = useRef(false);

  useEffect(() => {
    if (!sessionId || !campaignId || isSetup.current) return;
    isSetup.current = true;

    let mounted = true;

    async function setup() {
      try {
        const token = await getToken();
        if (!token || !mounted) return;

        await connectSocket(token);
        if (!mounted) return;

        const socket = getSocket();
        setConnected(true);

        // Join the session room
        socket.emit('session:join', { sessionId: sessionId!, campaignId: campaignId! });

        // Listen for room state (initial connected users)
        socket.on('session:roomState', ({ users }) => {
          setConnectedUsers(users);
          // Determine our role from the users list — server already sets it
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
        });

        socket.on('disconnect', () => {
          if (mounted) setConnected(false);
        });
      } catch (err) {
        console.error('[Socket] Setup failed:', err);
      }
    }

    void setup();

    return () => {
      mounted = false;
      isSetup.current = false;
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
      setConnected(false);
    };
  }, [sessionId, campaignId]);
}
