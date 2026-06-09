import { useEffect } from 'react';
import { getSocket } from '@/lib/socket';
import { useHandoutViewerStore } from './handoutViewerStore';

/** Show item handout popups when the GM reveals them to the session. */
export function useHandoutRevealSocket(sessionId: string | null) {
  useEffect(() => {
    if (!sessionId) return;
    const socket = getSocket();

    function onReveal(payload: {
      sessionId: string;
      title: string;
      content: string;
      imageUrl?: string;
    }) {
      if (payload.sessionId !== sessionId) return;
      useHandoutViewerStore.getState().openContent({
        title: payload.title,
        description: payload.content,
        ...(payload.imageUrl ? { imageUrl: payload.imageUrl } : {}),
      });
    }

    socket.on('handout:reveal', onReveal);
    return () => {
      socket.off('handout:reveal', onReveal);
    };
  }, [sessionId]);
}
