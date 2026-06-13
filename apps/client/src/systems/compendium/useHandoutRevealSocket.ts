import { useEffect } from 'react';
import type { HandoutRevealPayload } from '@grimoire/shared';
import { getSocket } from '@/lib/socket';
import { useHandoutViewerStore } from './handoutViewerStore';
import { useHandoutJournalStore } from '@/systems/handouts/handoutJournalStore';
import { useSessionStore } from '@/store/sessionStore';

/** Show handout popups when the GM reveals them to the session. */
export function useHandoutRevealSocket(sessionId: string | null) {
  useEffect(() => {
    if (!sessionId) return;
    const socket = getSocket();

    function onReveal(payload: HandoutRevealPayload) {
      if (payload.sessionId !== sessionId) return;
      const myUserId = useSessionStore.getState().myUserId;
      if (
        payload.targetUserIds !== 'all'
        && myUserId
        && !payload.targetUserIds.includes(myUserId)
      ) {
        return;
      }

      useHandoutViewerStore.getState().openContent({
        ...(payload.receiptId ? { receiptId: payload.receiptId } : {}),
        handoutId: payload.handoutId,
        title: payload.title,
        description: payload.content,
        ...(payload.imageUrl ? { imageUrl: payload.imageUrl } : {}),
        ...(payload.type ? { handoutType: payload.type } : {}),
        ...(payload.itemMeta?.itemType ? { itemType: payload.itemMeta.itemType } : {}),
        ...(payload.itemMeta?.rarity ? { rarity: payload.itemMeta.rarity } : {}),
        ...(payload.itemMeta?.source ? { source: payload.itemMeta.source } : {}),
        ...(payload.itemMeta?.isCustom !== undefined ? { isCustom: payload.itemMeta.isCustom } : {}),
        animate: payload.animate ?? true,
      });

      if (payload.receiptId) {
        const campaignId = useSessionStore.getState().campaignId;
        if (campaignId) void useHandoutJournalStore.getState().loadJournal(campaignId);
      }
    }

    socket.on('handout:reveal', onReveal);
    return () => {
      socket.off('handout:reveal', onReveal);
    };
  }, [sessionId]);
}
