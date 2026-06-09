import { useEffect } from 'react';
import { useAuth } from '@clerk/clerk-react';
import type { DdbCharacterSyncPayload, DdbHpUpdatePayload } from '@grimoire/shared';
import { getSocket } from '@/lib/socket';
import { useSessionStore } from '@/store/sessionStore';
import { useDiceStore } from '@/systems/dice/diceStore';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { pullDdbHpToToken } from './useDdbHpSync';
import { requestDdbRollBridgeStart } from './startRollBridge';
import { useDdbStore } from './ddbStore';
import { bindDdbRollSocket } from './bindDdbRollSocket';
import { fetchDdbRollPoll } from './ddbApi';

export function useDdbSocket(): void {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const sessionId = useSessionStore((s) => s.sessionId);
  const campaignId = useSessionStore((s) => s.campaignId);
  const isConnected = useSessionStore((s) => s.isConnected);
  const rollBridgeNonce = useDdbStore((s) => s.rollBridgeNonce);

  useEffect(() => {
    if (!sessionId || !isConnected || !isLoaded || !isSignedIn) return;

    bindDdbRollSocket(true);
    const socket = getSocket();

    const startTimer = setTimeout(() => {
      if (useSessionStore.getState().myRole === 'GM') {
        void requestDdbRollBridgeStart();
      }
    }, 1200);

    // HTTP poll — reliable path; does not depend on socket room or server bridge process.
    let pollCancelled = false;
    const runPoll = async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const rolls = await fetchDdbRollPoll(sessionId);
        for (const roll of rolls) {
          if (pollCancelled) return;
          console.info('[DDB] roll received:', roll.characterName, roll.label, roll.total);
          useDiceStore.getState().addDdbRollEntry(roll);
        }
      } catch {
        // ignore transient poll errors
      }
    };
    void runPoll();
    const pollTimer = setInterval(() => void runPoll(), 2500);
    console.info('[DDB] roll poll active (session', sessionId + ') — roll on dndbeyond.com; logs appear here in Grimoire, not on DDB.');

    const onSync = (payload: DdbCharacterSyncPayload) => {
      if (payload.sessionId !== sessionId) return;
      const tokens = Object.values(useItemStore.getState().items).filter(
        (i) => i.type === 'token' && i.ddbCharacterId === payload.ddbCharacterId,
      );
      void tokens;
    };

    const onHpUpdate = (payload: DdbHpUpdatePayload) => {
      if (payload.sessionId !== sessionId) return;
      const token = Object.values(useItemStore.getState().items).find(
        (i) => i.type === 'token' && i.ddbCharacterId === payload.ddbCharacterId,
      );
      if (token) {
        pullDdbHpToToken(token.id, payload);
      }
    };

    socket.on('ddb:characterSync', onSync);
    socket.on('character:hpUpdate', onHpUpdate);

    return () => {
      pollCancelled = true;
      clearTimeout(startTimer);
      clearInterval(pollTimer);
      socket.off('ddb:characterSync', onSync);
      socket.off('character:hpUpdate', onHpUpdate);
    };
  }, [sessionId, campaignId, rollBridgeNonce, isConnected, isLoaded, isSignedIn, getToken]);
}
