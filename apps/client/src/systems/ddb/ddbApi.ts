import axios from 'axios';
import { api } from '@/lib/axios';
import {
  coerceGrimoireCharacter,
  type DdbCampaignSummary,
  type DdbCharacterSummary,
  type DdbEncounter,
  type DdbLibraryImportResult,
  type DdbLibraryItemSummary,
  type DdbLibraryMonsterSummary,
  type DdbLibrarySpellSummary,
  type DdbLinkStatus,
  type DdbRollBridgePayload,
  type DdbSourceSummary,
  type GrimoireCharacter,
} from '@grimoire/shared';
import type { TokenItem } from '@/systems/scene/types';

export async function fetchDdbStatus(): Promise<DdbLinkStatus> {
  const { data } = await api.get<DdbLinkStatus>('/ddb/status');
  return data;
}

export async function linkDdbAccount(cobalt: string): Promise<DdbLinkStatus> {
  try {
    const { data } = await api.post<DdbLinkStatus>('/ddb/link', { cobalt: cobalt.trim() });
    return data;
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const msg = (err.response?.data as { error?: string } | undefined)?.error;
      throw new Error(msg ?? 'Failed to link D&D Beyond account');
    }
    throw err;
  }
}

export async function unlinkDdbAccount(): Promise<void> {
  await api.delete('/ddb/link');
}

export async function fetchDdbCampaigns(): Promise<DdbCampaignSummary[]> {
  const { data } = await api.get<{ campaigns: DdbCampaignSummary[] }>('/ddb/campaigns');
  return data.campaigns;
}

export async function fetchDdbCharacters(): Promise<DdbCharacterSummary[]> {
  const { data } = await api.get<{ characters: DdbCharacterSummary[] }>('/ddb/characters');
  return data.characters;
}

export async function fetchDdbCharacter(id: number): Promise<GrimoireCharacter> {
  try {
    const { data } = await api.get<{ character: GrimoireCharacter }>(`/ddb/characters/${id}`);
    return coerceGrimoireCharacter(data.character);
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const msg = (err.response?.data as { error?: string } | undefined)?.error;
      throw new Error(msg ?? 'Failed to load D&D Beyond character');
    }
    throw err;
  }
}

export async function syncDdbCharacter(id: number): Promise<GrimoireCharacter> {
  const { data } = await api.post<{ character: GrimoireCharacter }>(`/ddb/characters/${id}/sync`);
  return coerceGrimoireCharacter(data.character);
}

export async function importDdbCharacterToken(id: number): Promise<{
  character: GrimoireCharacter;
  tokenDefaults: Partial<TokenItem>;
}> {
  try {
    const { data } = await api.post<{
      character: GrimoireCharacter;
      tokenDefaults: Partial<TokenItem>;
    }>(`/ddb/characters/${id}/import-token`);
    return data;
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const msg = (err.response?.data as { error?: string } | undefined)?.error;
      throw new Error(msg ?? 'Failed to import character');
    }
    throw err;
  }
}

export async function patchDdbDeathSaves(
  id: number,
  deathSaves: { successes: number; failures: number; stabilized?: boolean },
  options?: { hp?: number; tempHp?: number },
): Promise<{ pushedToDdb: boolean; character: GrimoireCharacter }> {
  const { data } = await api.patch<{ pushedToDdb: boolean; character: GrimoireCharacter }>(
    `/ddb/characters/${id}/death-saves`,
    { ...deathSaves, ...options },
  );
  return data;
}

export async function patchDdbHp(
  id: number,
  hp: number,
  tempHp: number,
): Promise<{ pushedToDdb: boolean; character: GrimoireCharacter }> {
  const { data } = await api.patch<{ pushedToDdb: boolean; character: GrimoireCharacter }>(
    `/ddb/characters/${id}/hp`,
    { hp, tempHp },
  );
  return data;
}

export async function linkGrimoireCampaign(
  campaignId: string,
  ddbCampaignId: number,
): Promise<{ ddbCampaignId: number }> {
  const { data } = await api.post<{ link: { ddbCampaignId: number } }>(
    `/ddb/campaigns/${campaignId}/link`,
    { ddbCampaignId },
  );
  return { ddbCampaignId: data.link.ddbCampaignId };
}

export async function fetchGrimoireDdbLink(
  campaignId: string,
): Promise<{ ddbCampaignId: number } | null> {
  const { data } = await api.get<{ link: { ddbCampaignId: number } | null }>(
    `/ddb/campaigns/${campaignId}/ddb-link`,
  );
  return data.link;
}

export async function fetchDdbEncounters(ddbCampaignId: number): Promise<DdbEncounter[]> {
  const { data } = await api.get<{ encounters: DdbEncounter[] }>(
    `/ddb/campaigns/${ddbCampaignId}/encounters`,
  );
  return data.encounters;
}

export async function prepareEncounterSummon(
  encounterId: string,
  ddbCampaignId: number,
): Promise<DdbEncounter> {
  const { data } = await api.post<{ encounter: DdbEncounter }>(
    `/ddb/encounters/${encounterId}/summon`,
    { ddbCampaignId },
  );
  return data.encounter;
}

export async function updateDdbSettings(settings: {
  syncHpToDdb?: boolean;
  rollBridgeEnabled?: boolean;
}): Promise<{ syncHpToDdb: boolean; rollBridgeEnabled: boolean }> {
  const { data } = await api.patch<{ syncHpToDdb: boolean; rollBridgeEnabled: boolean }>(
    '/ddb/settings',
    settings,
  );
  return data;
}

export interface RollBridgeStatus {
  active: boolean;
  pollSeeded?: boolean;
  seenCount?: number;
  ddbCampaignId?: number;
  ddbUserId?: number;
}

export async function fetchRollBridgeStatus(sessionId: string): Promise<RollBridgeStatus> {
  const { data } = await api.get<RollBridgeStatus>(`/ddb/bridge/${sessionId}`);
  return data;
}

export async function fetchDdbRollPoll(sessionId: string): Promise<DdbRollBridgePayload[]> {
  const { data } = await api.get<{ rolls: DdbRollBridgePayload[] }>(
    `/ddb/sessions/${sessionId}/rolls/poll`,
  );
  return data.rolls ?? [];
}

export async function fetchDdbLibrarySources(): Promise<DdbSourceSummary[]> {
  const { data } = await api.get<{ sources: DdbSourceSummary[] }>('/ddb/library/sources');
  return data.sources ?? [];
}

export async function searchDdbLibraryMonsters(params: {
  q?: string;
  sourceId?: number;
  sourceIds?: number[];
  skip?: number;
  take?: number;
}): Promise<{ items: DdbLibraryMonsterSummary[]; total: number }> {
  const { sourceIds, ...rest } = params;
  const { data } = await api.get<{ items: DdbLibraryMonsterSummary[]; total: number }>(
    '/ddb/library/monsters',
    {
      params: {
        ...rest,
        ...(sourceIds?.length ? { sourceIds: sourceIds.join(',') } : {}),
      },
    },
  );
  return data;
}

export async function searchDdbLibrarySpells(params: {
  q?: string;
  sourceId?: number;
  sourceIds?: number[];
  campaignId?: number;
  limit?: number;
}): Promise<DdbLibrarySpellSummary[]> {
  const { sourceIds, ...rest } = params;
  const { data } = await api.get<{ items: DdbLibrarySpellSummary[] }>('/ddb/library/spells', {
    params: {
      ...rest,
      ...(sourceIds?.length ? { sourceIds: sourceIds.join(',') } : {}),
    },
  });
  return data.items ?? [];
}

export async function searchDdbLibraryItems(params: {
  q?: string;
  sourceId?: number;
  sourceIds?: number[];
  campaignId?: number;
  limit?: number;
}): Promise<DdbLibraryItemSummary[]> {
  const { sourceIds, ...rest } = params;
  const { data } = await api.get<{ items: DdbLibraryItemSummary[] }>('/ddb/library/items', {
    params: {
      ...rest,
      ...(sourceIds?.length ? { sourceIds: sourceIds.join(',') } : {}),
    },
  });
  return data.items ?? [];
}

export async function importDdbLibraryEntries(body: {
  kind: 'monster' | 'item' | 'spell';
  ids: number[];
  campaignId?: number;
  sourceId?: number;
}): Promise<DdbLibraryImportResult> {
  try {
    const { data } = await api.post<DdbLibraryImportResult>('/ddb/library/import', body);
    return data;
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const msg = (err.response?.data as { error?: string } | undefined)?.error;
      throw new Error(msg ?? 'Import failed');
    }
    throw err;
  }
}

export async function importAllDdbLibraryFromSource(body: {
  sourceId?: number;
  sourceIds?: number[];
  campaignId?: number;
}): Promise<DdbLibraryImportResult> {
  try {
    const sourceIds = [
      ...new Set(
        (body.sourceIds?.length ? body.sourceIds : body.sourceId != null ? [body.sourceId] : [])
          .map((id) => Number(id))
          .filter((id) => Number.isFinite(id) && id > 0),
      ),
    ];
    if (sourceIds.length === 0) {
      throw new Error('Select at least one source book');
    }
    const { data } = await api.post<DdbLibraryImportResult>('/ddb/library/import-all', {
      sourceIds,
      ...(body.campaignId != null && Number(body.campaignId) > 0
        ? { campaignId: Number(body.campaignId) }
        : {}),
    });
    return data;
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const msg = (err.response?.data as { error?: string } | undefined)?.error;
      throw new Error(msg ?? 'Import all failed');
    }
    throw err;
  }
}
