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
import { isApiAuthError } from '@/lib/axios';

const POLL_MS = 2500;
const POLL_MS_CONNECTED = 12_000;

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
    let pollPaused = false;
    const runPoll = async () => {
      if (pollPaused) return;
      try {
        const token = await getToken();
        if (!token) {
          pollPaused = true;
          return;
        }
        const rolls = await fetchDdbRollPoll(sessionId);
        // When the socket is live, rolls arrive via ddb:roll — poll only wakes the server fetch.
        if (pollCancelled || useSessionStore.getState().isConnected) return;
        for (const roll of rolls) {
          if (pollCancelled) return;
          console.info('[DDB] roll received (poll):', roll.characterName, roll.label, roll.total);
          useDiceStore.getState().addDdbRollEntry(roll);
        }
      } catch (err) {
        if (isApiAuthError(err)) {
          pollPaused = true;
          const fresh = await getToken({ skipCache: true });
          if (fresh) pollPaused = false;
        }
      }
    };
    const resumePoll = () => {
      pollPaused = false;
      void runPoll();
    };
    window.addEventListener('grimoire:auth-recovered', resumePoll);
    void runPoll();
    const pollMs = isConnected ? POLL_MS_CONNECTED : POLL_MS;
    const pollTimer = setInterval(() => void runPoll(), pollMs);
    console.info(`[DDB] roll poll active (${pollMs}ms, session ${sessionId}) — roll on dndbeyond.com; logs appear here in Grimoire, not on DDB.`);

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
      window.removeEventListener('grimoire:auth-recovered', resumePoll);
      clearTimeout(startTimer);
      clearInterval(pollTimer);
      socket.off('ddb:characterSync', onSync);
      socket.off('character:hpUpdate', onHpUpdate);
    };
  }, [sessionId, campaignId, rollBridgeNonce, isConnected, isLoaded, isSignedIn, getToken]);
}
