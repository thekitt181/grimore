import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSessionStore } from '@/store/sessionStore';
import { useDdbStore } from '@/systems/ddb/ddbStore';
import {
  fetchDdbStatus,
  fetchGrimoireDdbLink,
  prepareEncounterSummon,
  resolveDdbEncounterRef,
} from '@/systems/ddb/ddbApi';
import { ddbEncountersQueryKey, useDdbEncounters } from '@/systems/ddb/useDdbEncounters';
import { extractApiError } from '@/lib/apiError';
import { summonEncounterMonsters } from '@/systems/ddb/summonEncounter';
import { BD, GOLD } from '../dmStyles';

export function EncounterTab() {
  const qc = useQueryClient();
  const campaignId = useSessionStore((s) => s.campaignId);
  const setEncounterPanelOpen = useDdbStore((s) => s.setEncounterPanelOpen);
  const [summoning, setSummoning] = useState<string | null>(null);
  const [importRef, setImportRef] = useState('');
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const { data: ddbStatus } = useQuery({
    queryKey: ['ddb', 'status'],
    queryFn: fetchDdbStatus,
  });

  const { data: link } = useQuery({
    queryKey: ['ddb', 'campaign-link', campaignId],
    queryFn: () => (campaignId ? fetchGrimoireDdbLink(campaignId) : null),
    enabled: Boolean(campaignId),
  });

  const ddbCampaignId = link?.ddbCampaignId ?? null;

  const {
    data: encounters,
    isLoading,
    isFetching,
    refetch,
  } = useDdbEncounters(ddbCampaignId);

  async function refreshEncounters() {
    await refetch();
  }

  async function handleSummon(encounterId: string) {
    setSummoning(encounterId);
    setMessage(null);
    try {
      const enc = await prepareEncounterSummon(
        encounterId,
        ddbCampaignId ?? undefined,
      );
      const spawned = await summonEncounterMonsters(enc.monsters);
      setMessage(`Summoned ${spawned.length} token(s) from “${enc.name}”.`);
    } catch (err) {
      setMessage(extractApiError(err, 'Summon failed'));
    } finally {
      setSummoning(null);
    }
  }

  async function handleImportByRef() {
    const ref = importRef.trim();
    if (!ref) return;
    setImporting(true);
    setMessage(null);
    try {
      const enc = await resolveDdbEncounterRef(ref, ddbCampaignId ?? undefined);
      const spawned = await summonEncounterMonsters(enc.monsters);
      setMessage(`Imported “${enc.name}” — ${spawned.length} token(s) on the map.`);
      setImportRef('');
      void qc.invalidateQueries({ queryKey: ddbEncountersQueryKey(ddbCampaignId) });
    } catch (err) {
      setMessage(extractApiError(err, 'Could not import encounter'));
    } finally {
      setImporting(false);
    }
  }

  if (!ddbStatus?.linked) {
    return (
      <p className="font-ui text-xs" style={{ color: 'var(--color-text-secondary)' }}>
        Link D&amp;D Beyond in the sidebar → <strong>Account link</strong>, then use Encounters here or open the full campaign panel.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="font-ui text-[10px] leading-snug" style={{ color: 'var(--color-text-secondary)' }}>
        Encounters saved <strong>inside your DDB campaign</strong> appear below. The standalone Encounter Builder
        (browser tab) often does not — paste its URL or id to import directly.
      </p>

      <div className="space-y-1.5">
        <label className="font-ui text-[10px] block" style={{ color: 'var(--color-text-secondary)' }}>
          Import from Encounter Builder URL or id
        </label>
        <div className="flex gap-1">
          <input
            className="input-dark flex-1 text-xs py-1"
            placeholder="https://www.dndbeyond.com/encounters/xxxxxxxx-xxxx-…"
            value={importRef}
            onChange={(e) => setImportRef(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void handleImportByRef()}
          />
          <button
            type="button"
            className="btn-primary text-[10px] px-2 py-1 shrink-0 disabled:opacity-50"
            disabled={importing || !importRef.trim()}
            onClick={() => void handleImportByRef()}
          >
            {importing ? '…' : 'Import'}
          </button>
        </div>
      </div>

      <button type="button" className="btn-ghost w-full text-xs py-1.5" onClick={() => setEncounterPanelOpen(true)}>
        Open full DDB campaign panel
      </button>

      {ddbCampaignId && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] opacity-60">
            Linked DDB campaign id: {ddbCampaignId}
          </p>
          <button
            type="button"
            className="btn-ghost text-[10px] py-0.5 px-1.5 shrink-0 disabled:opacity-50"
            disabled={isFetching}
            onClick={() => void refreshEncounters()}
          >
            {isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      )}

      {!ddbCampaignId && (
        <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
          Link this Grimoire campaign to a DDB campaign to list saved encounters — or use Import above for Encounter Builder.
        </p>
      )}

      {message && (
        <p className="text-[10px] rounded px-2 py-1" style={{ background: 'rgba(201,168,76,0.1)', color: GOLD }}>
          {message}
        </p>
      )}

      {isLoading && ddbCampaignId && (
        <p className="text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>Loading campaign encounters…</p>
      )}

      {encounters && encounters.length === 0 && ddbCampaignId && (
        <p className="text-[10px] leading-snug" style={{ color: 'var(--color-text-secondary)' }}>
          No encounters saved on this DDB campaign yet. In D&amp;D Beyond, save the encounter to the campaign
          (not just the Encounter Builder tab), or paste the builder URL above.
        </p>
      )}

      <div className="space-y-1.5">
        {encounters?.map((enc) => (
          <div
            key={enc.id}
            className="flex items-center gap-2 rounded px-2 py-1.5"
            style={{ background: 'var(--color-bg-primary)', border: `1px solid ${BD}` }}
          >
            <div className="flex-1 min-w-0">
              <div className="font-ui text-xs truncate" style={{ color: 'var(--color-text-primary)' }}>{enc.name}</div>
              <div className="text-[10px] opacity-60">
                {(enc.monsters ?? []).reduce((n, m) => n + m.count, 0)} creature
                {(enc.monsters ?? []).reduce((n, m) => n + m.count, 0) === 1 ? '' : 's'}
              </div>
            </div>
            <button
              type="button"
              className="btn-primary text-[10px] py-0.5 px-2 shrink-0 disabled:opacity-50"
              disabled={summoning === enc.id}
              onClick={() => void handleSummon(enc.id)}
            >
              {summoning === enc.id ? '…' : 'Summon'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
