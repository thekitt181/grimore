import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DraggablePanel } from '@/components/DraggablePanel';
import { useSessionStore } from '@/store/sessionStore';
import {
  fetchDdbCampaigns,
  fetchDdbEncounters,
  fetchDdbStatus,
  fetchGrimoireDdbLink,
  linkGrimoireCampaign,
  prepareEncounterSummon,
} from './ddbApi';
import { summonEncounterMonsters } from './summonEncounter';
import { requestDdbRollBridgeStart } from './startRollBridge';
import { useDdbStore } from './ddbStore';

const GOLD = 'var(--color-accent-gold)';
const BD = 'var(--color-border)';

function parseCampaignIdInput(raw: string): number | null {
  const trimmed = raw.trim();
  const fromUrl = trimmed.match(/campaigns\/(\d+)/i);
  const id = parseInt(fromUrl?.[1] ?? trimmed, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export function DdbEncounterPanel({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const campaignId = useSessionStore((s) => s.campaignId);
  const [manualId, setManualId] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);
  const [summoning, setSummoning] = useState<string | null>(null);
  const [bridgeMessage, setBridgeMessage] = useState<string | null>(null);
  const bumpRollBridge = useDdbStore((s) => s.bumpRollBridge);

  const { data: ddbStatus } = useQuery({
    queryKey: ['ddb', 'status'],
    queryFn: fetchDdbStatus,
  });

  const { data: link } = useQuery({
    queryKey: ['ddb', 'campaign-link', campaignId],
    queryFn: () => (campaignId ? fetchGrimoireDdbLink(campaignId) : null),
    enabled: Boolean(campaignId),
  });

  const { data: ddbCampaigns, isLoading: campaignsLoading } = useQuery({
    queryKey: ['ddb', 'campaigns'],
    queryFn: fetchDdbCampaigns,
    enabled: Boolean(ddbStatus?.linked),
  });

  const ddbCampaignId = link?.ddbCampaignId ?? null;
  const linkedCampaignName = ddbCampaigns?.find((c) => c.ddbCampaignId === ddbCampaignId)?.name;

  const { data: encounters, isLoading: encountersLoading } = useQuery({
    queryKey: ['ddb', 'encounters', ddbCampaignId],
    queryFn: () => fetchDdbEncounters(ddbCampaignId!),
    enabled: Boolean(ddbCampaignId),
  });

  const linkMutation = useMutation({
    mutationFn: (id: number) => linkGrimoireCampaign(campaignId!, id),
    onSuccess: async () => {
      setLinkError(null);
      setManualId('');
      void qc.invalidateQueries({ queryKey: ['ddb', 'campaign-link', campaignId] });
      bumpRollBridge();
      const result = await requestDdbRollBridgeStart();
      setBridgeMessage(
        !result.started
          ? result.reason
          : result.connected
            ? 'Roll bridge active. Roll on D&D Beyond now.'
            : 'Bridge requested — click Connect rolls if rolls do not appear.',
      );
    },
    onError: (err: Error) => setLinkError(err.message),
  });

  async function handleConnectRolls() {
    bumpRollBridge();
    const result = await requestDdbRollBridgeStart();
    if (!result.started) {
      setBridgeMessage(result.reason);
      return;
    }
    setBridgeMessage(
      result.connected
        ? 'Roll bridge active. Roll on D&D Beyond now — appears in ~3s.'
        : 'Bridge start requested but server not polling yet. Restart server and try again.',
    );
  }

  function handleLink(id: number) {
    if (!campaignId) return;
    linkMutation.mutate(id);
  }

  async function handleSummon(encounterId: string) {
    if (!ddbCampaignId) return;
    setSummoning(encounterId);
    try {
      const enc = await prepareEncounterSummon(encounterId, ddbCampaignId);
      await summonEncounterMonsters(enc.monsters);
      onClose();
    } finally {
      setSummoning(null);
    }
  }

  return (
    <DraggablePanel
      title="DDB Campaign"
      subtitle="Encounters & campaign link"
      onClose={onClose}
      defaultPosition={{ x: Math.max(16, (window.innerWidth - 340) / 2), y: 64 }}
      width={320}
      maxHeight="70vh"
      zIndex={140}
    >
      <div className="p-4 flex flex-col overflow-hidden">
      {!ddbStatus?.linked ? (
        <p className="text-xs mb-3" style={{ color: 'var(--color-text-secondary)' }}>
          Link your D&D Beyond account first — sidebar → <strong>Account link</strong>.
        </p>
      ) : !campaignId ? (
        <p className="text-xs mb-3" style={{ color: 'var(--color-text-secondary)' }}>
          Join a session to link this Grimoire campaign to D&D Beyond.
        </p>
      ) : (
        <div className="mb-3 shrink-0 space-y-2">
          {ddbCampaignId ? (
            <div
              className="rounded px-2 py-1.5 text-xs"
              style={{ background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.35)' }}
            >
              <span style={{ color: '#4ade80' }}>✓ Linked</span>
              {' — '}
              {linkedCampaignName ?? `Campaign ${ddbCampaignId}`}
              <span className="block mt-0.5 opacity-70">ID {ddbCampaignId}</span>
              <span className="block mt-1 opacity-70">
                Roll bridge and HP sync use this campaign. Encounters are optional.
              </span>
              <button
                type="button"
                className="btn-primary text-[10px] mt-2 w-full"
                onClick={() => void handleConnectRolls()}
              >
                Connect rolls
              </button>
              {!ddbStatus?.rollBridgeEnabled && (
                <span className="block mt-1" style={{ color: '#fbbf24' }}>
                  Roll bridge is off — enable it under Account link.
                </span>
              )}
              {bridgeMessage && (
                <span className="block mt-1 opacity-80">{bridgeMessage}</span>
              )}
              <span className="block mt-1 opacity-60 text-[10px]">
                Roll from a character sheet in this DDB campaign (browser). Rolls appear in the dice tray for everyone in the session.
              </span>
            </div>
          ) : (
            <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
              Connect your Grimoire campaign to D&D Beyond for roll bridge and sync.
            </p>
          )}

          {campaignsLoading && (
            <p className="text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>Loading your DDB campaigns…</p>
          )}

          {!campaignsLoading && ddbCampaigns && ddbCampaigns.length > 0 && (
            <div>
              <label className="font-ui text-[10px] block mb-1" style={{ color: 'var(--color-text-secondary)' }}>
                {ddbCampaignId ? 'Change linked campaign' : 'Select D&D Beyond campaign'}
              </label>
              <select
                className="w-full text-xs rounded px-2 py-1"
                style={{ background: 'var(--color-bg-primary)', border: `1px solid ${BD}` }}
                value={ddbCampaignId ?? ''}
                onChange={(e) => {
                  const id = parseInt(e.target.value, 10);
                  if (id) handleLink(id);
                }}
              >
                <option value="" disabled>Select campaign…</option>
                {ddbCampaigns.map((c) => (
                  <option key={c.ddbCampaignId} value={c.ddbCampaignId}>{c.name}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="font-ui text-[10px] block mb-1" style={{ color: 'var(--color-text-secondary)' }}>
              Or paste campaign ID / URL
            </label>
            <div className="flex gap-1">
              <input
                type="text"
                className="flex-1 text-xs rounded px-2 py-1"
                style={{ background: 'var(--color-bg-primary)', border: `1px solid ${BD}` }}
                placeholder="1823178 or dndbeyond.com/campaigns/…"
                value={manualId}
                onChange={(e) => setManualId(e.target.value)}
              />
              <button
                type="button"
                className="btn-primary text-[10px] px-2 shrink-0"
                disabled={linkMutation.isPending}
                onClick={() => {
                  const id = parseCampaignIdInput(manualId);
                  if (!id) {
                    setLinkError('Enter a valid campaign ID (number from your DDB campaign URL).');
                    return;
                  }
                  handleLink(id);
                }}
              >
                Link
              </button>
            </div>
          </div>

          {!campaignsLoading && ddbCampaigns?.length === 0 && (
            <p className="text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>
              No campaigns returned from D&D Beyond — use the ID field above. Find it at{' '}
              <span style={{ color: GOLD }}>dndbeyond.com/campaigns/12345</span>.
            </p>
          )}

          {linkError && (
            <p className="text-[10px]" style={{ color: '#f87171' }}>{linkError}</p>
          )}
          {linkMutation.isPending && (
            <p className="text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>Linking…</p>
          )}
        </div>
      )}

      {ddbCampaignId && (
        <>
          <h4 className="font-display text-[10px] tracking-wider uppercase mb-1 shrink-0" style={{ color: GOLD }}>
            Encounters
          </h4>
          <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
            {encountersLoading && <p className="text-xs">Loading encounters…</p>}
            {!encountersLoading && (!encounters || encounters.length === 0) && (
              <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                No encounters in this campaign. That is fine — roll bridge still works once linked above.
              </p>
            )}
            {encounters?.map((enc) => (
              <div
                key={enc.id}
                className="rounded px-3 py-2 flex items-center justify-between gap-2"
                style={{ background: 'var(--color-bg-tertiary)', border: `1px solid ${BD}` }}
              >
                <div className="min-w-0">
                  <div className="font-display text-xs truncate" style={{ color: GOLD }}>{enc.name}</div>
                  <div className="text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>
                    {enc.monsters.length} monster type(s)
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-primary text-[10px] shrink-0"
                  disabled={summoning === enc.id}
                  onClick={() => void handleSummon(enc.id)}
                >
                  {summoning === enc.id ? '…' : 'Summon'}
                </button>
              </div>
            ))}
          </div>
        </>
      )}
      </div>
    </DraggablePanel>
  );
}
