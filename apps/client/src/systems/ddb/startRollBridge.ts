import { getSocket } from '@/lib/socket';
import { useSessionStore } from '@/store/sessionStore';
import { fetchDdbStatus, fetchGrimoireDdbLink, fetchRollBridgeStatus } from './ddbApi';

export type RollBridgeStartResult =
  | { started: true; connected: boolean }
  | { started: false; reason: string };

/** Ask the server to connect to the D&D Beyond game-log WebSocket for this session. */
export async function requestDdbRollBridgeStart(): Promise<RollBridgeStartResult> {
  const { sessionId, campaignId } = useSessionStore.getState();
  if (!sessionId || !campaignId) {
    return { started: false, reason: 'Join a session first.' };
  }

  const [status, link] = await Promise.all([
    fetchDdbStatus().catch(() => null),
    fetchGrimoireDdbLink(campaignId).catch(() => null),
  ]);

  if (!status?.linked) {
    return { started: false, reason: 'Link your D&D Beyond account (Account link in sidebar).' };
  }
  if (!status.rollBridgeEnabled) {
    return {
      started: false,
      reason: 'Enable “Roll bridge” in Account link settings, then click Connect rolls below.',
    };
  }
  if (!link?.ddbCampaignId) {
    return { started: false, reason: 'Link a D&D Beyond campaign in this panel first.' };
  }

  getSocket().emit('ddb:rollBridge:start', {
    sessionId,
    ddbCampaignId: link.ddbCampaignId,
  });

  await new Promise((r) => setTimeout(r, 1500));
  const bridgeStatus = await fetchRollBridgeStatus(sessionId).catch(() => null);
  if (bridgeStatus?.active) {
    return { started: true, connected: true };
  }
  return {
    started: true,
    connected: false,
  };
}
