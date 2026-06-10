import axios from 'axios';
import { api } from '@/lib/axios';
import { extractApiError } from '@/lib/apiError';
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
  try {
    const { data } = await api.post<{ character: GrimoireCharacter }>(`/ddb/characters/${id}/sync`);
    return coerceGrimoireCharacter(data.character);
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const msg = (err.response?.data as { error?: string } | undefined)?.error;
      throw new Error(msg ?? 'Failed to sync D&D Beyond character');
    }
    throw err;
  }
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
  const { sourceIds, sourceId, ...rest } = params;
  const resolvedSourceIds = sourceIds?.length
    ? sourceIds
    : sourceId != null && sourceId > 0
      ? [sourceId]
      : undefined;
  try {
    const { data } = await api.get<{ items: DdbLibraryMonsterSummary[]; total: number }>(
      '/ddb/library/monsters',
      {
        params: {
          ...rest,
          ...(resolvedSourceIds?.length ? { sourceIds: resolvedSourceIds.join(',') } : {}),
        },
      },
    );
    return data;
  } catch (err) {
    throw new Error(extractApiError(err, 'Monster search failed'));
  }
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

const MONSTER_IMPORT_CHUNK = 2;
const DEFAULT_IMPORT_CHUNK = 10;

function importChunkSize(kind: 'monster' | 'item' | 'spell'): number {
  return kind === 'monster' ? MONSTER_IMPORT_CHUNK : DEFAULT_IMPORT_CHUNK;
}

function isTimeoutStatus(status?: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

async function postImportChunk(
  body: {
    kind: 'monster' | 'item' | 'spell';
    ids: number[];
    campaignId?: number;
    sourceId?: number;
  },
): Promise<DdbLibraryImportResult> {
  const payload = {
    kind: body.kind,
    ids: body.ids.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0),
    ...(body.campaignId != null && Number(body.campaignId) > 0
      ? { campaignId: Number(body.campaignId) }
      : {}),
    ...(body.sourceId != null && Number(body.sourceId) > 0
      ? { sourceId: Number(body.sourceId) }
      : {}),
  };
  try {
    const { data } = await api.post<DdbLibraryImportResult>('/ddb/library/import', payload);
    return data;
  } catch (err) {
    throw new Error(extractApiError(err, 'Import failed'));
  }
}

async function importChunkWithRetry(
  body: {
    kind: 'monster' | 'item' | 'spell';
    ids: number[];
    campaignId?: number;
    sourceId?: number;
  },
): Promise<DdbLibraryImportResult> {
  try {
    return await postImportChunk(body);
  } catch (err) {
    if (!axios.isAxiosError(err) || body.ids.length <= 1) throw err;
    const status = err.response?.status;
    if (!isTimeoutStatus(status)) throw err;

    let merged: DdbLibraryImportResult = { imported: [], errors: [] };
    for (const id of body.ids) {
      try {
        merged = mergeImportResults(merged, await postImportChunk({ ...body, ids: [id] }));
      } catch (singleErr) {
        if (axios.isAxiosError(singleErr)) {
          merged.errors.push({
            id,
            message: extractApiError(singleErr, 'Server timed out — try again later'),
          });
          continue;
        }
        throw singleErr;
      }
    }
    return merged;
  }
}

export async function finishDdbLibraryImport(opts?: {
  sourceIds?: number[];
  sourceLabels?: string[];
  unlockAllImportedSources?: boolean;
}): Promise<{ catalogRev: string | null; sourcesUnlocked?: string[] }> {
  try {
    const { data } = await api.post<{ catalogRev: string | null; sourcesUnlocked?: string[] }>(
      '/ddb/library/finish-import',
      opts ?? {},
    );
    return data;
  } catch (err) {
    throw new Error(extractApiError(err, 'Could not sync compendium catalog'));
  }
}

/** Rebuild compendium catalog and unlock imported books after an interrupted import. */
export async function syncCompendiumAfterImport(opts?: {
  sourceIds?: number[];
  unlockAllImportedSources?: boolean;
}): Promise<{ catalogRev: string | null; sourcesUnlocked?: string[] }> {
  return finishDdbLibraryImport({
    ...(opts?.sourceIds?.length ? { sourceIds: opts.sourceIds } : {}),
    unlockAllImportedSources: opts?.unlockAllImportedSources ?? true,
  });
}

function sourceLabelsFromImport(result: DdbLibraryImportResult): string[] {
  return [...new Set(result.imported.map((e) => e.source).filter((s): s is string => Boolean(s)))];
}

function applyFinishResult(
  target: DdbLibraryImportResult,
  fin: { catalogRev: string | null; sourcesUnlocked?: string[] },
): void {
  if (fin.catalogRev) target.catalogRev = fin.catalogRev;
  if (fin.sourcesUnlocked?.length) {
    target.sourcesUnlocked = [...new Set([...(target.sourcesUnlocked ?? []), ...fin.sourcesUnlocked])];
  }
}

async function finalizeImportedCompendium(
  merged: DdbLibraryImportResult,
  sourceIds: number[],
): Promise<DdbLibraryImportResult> {
  if (merged.imported.length === 0) return merged;
  try {
    const sourceLabels = sourceLabelsFromImport(merged);
    const fin = await finishDdbLibraryImport({
      sourceIds,
      ...(sourceLabels.length > 0 ? { sourceLabels } : {}),
    });
    applyFinishResult(merged, fin);
  } catch (err) {
    console.warn('[DDB] finish-import failed:', err);
  }
  return merged;
}

/** Rebuild catalog and unlock one book after monsters + spells + items finish. */
async function finalizeBookImport(
  bookResult: DdbLibraryImportResult,
  sourceId: number,
): Promise<{ catalogRev: string | null; sourcesUnlocked?: string[] } | null> {
  if (bookResult.imported.length === 0) return null;
  try {
    const sourceLabels = sourceLabelsFromImport(bookResult);
    const fin = await finishDdbLibraryImport({
      sourceIds: [sourceId],
      ...(sourceLabels.length > 0 ? { sourceLabels } : {}),
    });
    applyFinishResult(bookResult, fin);
    return fin;
  } catch (err) {
    console.warn(`[DDB] finish-import failed for source ${sourceId}:`, err);
    return null;
  }
}

function chunkIds(ids: number[], size: number): number[][] {
  const chunks: number[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    chunks.push(ids.slice(i, i + size));
  }
  return chunks;
}

async function collectMonsterIdsForSource(sourceId: number): Promise<number[]> {
  const ids: number[] = [];
  let skip = 0;
  const take = 100;
  while (true) {
    const { items } = await searchDdbLibraryMonsters({ sourceId, skip, take });
    if (items.length === 0) break;
    ids.push(...items.map((m) => m.ddbId));
    skip += items.length;
    if (items.length < take) break;
  }
  return ids;
}

function mergeImportResults(a: DdbLibraryImportResult, b: DdbLibraryImportResult): DdbLibraryImportResult {
  const catalogRev = b.catalogRev ?? a.catalogRev;
  return {
    imported: [...a.imported, ...b.imported],
    errors: [...a.errors, ...b.errors],
    sourcesUnlocked: [...new Set([...(a.sourcesUnlocked ?? []), ...(b.sourcesUnlocked ?? [])])],
    mongoPersisted: a.mongoPersisted !== false && b.mongoPersisted !== false,
    ...(catalogRev ? { catalogRev } : {}),
  };
}

export async function importDdbLibraryEntries(
  body: {
    kind: 'monster' | 'item' | 'spell';
    ids: number[];
    campaignId?: number;
    sourceId?: number;
  },
  opts?: { skipFinish?: boolean },
): Promise<DdbLibraryImportResult> {
  const ids = [...new Set(body.ids.filter((id) => Number.isFinite(id) && id > 0))];
  if (ids.length === 0) {
    return { imported: [], errors: [{ id: 0, message: 'No entries selected' }] };
  }

  let merged: DdbLibraryImportResult = { imported: [], errors: [] };
  const chunkSize = importChunkSize(body.kind);
  const importOpts = {
    ...(body.campaignId != null && Number(body.campaignId) > 0
      ? { campaignId: Number(body.campaignId) }
      : {}),
    ...(body.sourceId != null ? { sourceId: body.sourceId } : {}),
  };

  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunkIds = ids.slice(i, i + chunkSize);
    try {
      merged = mergeImportResults(
        merged,
        await importChunkWithRetry({
          kind: body.kind,
          ids: chunkIds,
          ...importOpts,
        }),
      );
    } catch (err) {
      const detail = extractApiError(err, 'Import failed');
      for (const id of chunkIds) {
        merged.errors.push({ id, message: detail });
      }
      continue;
    }
  }

  if (!opts?.skipFinish && merged.imported.length > 0) {
    const finishSourceIds = body.sourceId != null ? [body.sourceId] : [];
    await finalizeImportedCompendium(merged, finishSourceIds);
  }

  return merged;
}

export type DdbImportAllProgress = {
  phase: 'monsters' | 'spells' | 'items' | 'complete';
  sourceId: number;
  sourceName?: string;
  done: number;
  total: number;
  bookImported?: number;
  bookErrors?: number;
};

export type DdbImportAllBookComplete = {
  sourceId: number;
  sourceName?: string;
  result: DdbLibraryImportResult;
  catalogRev: string | null;
};

export async function importAllDdbLibraryFromSource(
  body: {
    sourceId?: number;
    sourceIds?: number[];
    campaignId?: number;
    sourceNames?: Record<number, string>;
  },
  onProgress?: (progress: DdbImportAllProgress) => void,
  onBookComplete?: (info: DdbImportAllBookComplete) => void | Promise<void>,
): Promise<DdbLibraryImportResult> {
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

  let merged: DdbLibraryImportResult = { imported: [], errors: [] };
  const importOpts = {
    ...(body.campaignId != null && Number(body.campaignId) > 0
      ? { campaignId: Number(body.campaignId) }
      : {}),
  };

  const sourceNames = body.sourceNames ?? {};
  const finishedBooks = new Set<number>();

  try {
    for (const sourceId of sourceIds) {
      const sourceName = sourceNames[sourceId];
      let bookMerged: DdbLibraryImportResult = { imported: [], errors: [] };

      const monsterIds = await collectMonsterIdsForSource(sourceId);
      for (const [i, chunk] of chunkIds(monsterIds, MONSTER_IMPORT_CHUNK).entries()) {
        onProgress?.({
          phase: 'monsters',
          sourceId,
          ...(sourceName ? { sourceName } : {}),
          done: Math.min((i + 1) * MONSTER_IMPORT_CHUNK, monsterIds.length),
          total: monsterIds.length,
        });
        const chunkResult = await importDdbLibraryEntries(
          { kind: 'monster', ids: chunk, sourceId, ...importOpts },
          { skipFinish: true },
        );
        bookMerged = mergeImportResults(bookMerged, chunkResult);
        merged = mergeImportResults(merged, chunkResult);
      }

      const spells = await searchDdbLibrarySpells({
        sourceId,
        sourceIds: [sourceId],
        limit: 5000,
        ...importOpts,
      });
      const spellIds = spells.map((s) => s.ddbId).filter((id) => Number.isFinite(id) && id > 0);
      for (const [i, chunk] of chunkIds(spellIds, DEFAULT_IMPORT_CHUNK).entries()) {
        onProgress?.({
          phase: 'spells',
          sourceId,
          ...(sourceName ? { sourceName } : {}),
          done: Math.min((i + 1) * DEFAULT_IMPORT_CHUNK, spellIds.length),
          total: spellIds.length,
        });
        const chunkResult = await importDdbLibraryEntries(
          { kind: 'spell', ids: chunk, sourceId, ...importOpts },
          { skipFinish: true },
        );
        bookMerged = mergeImportResults(bookMerged, chunkResult);
        merged = mergeImportResults(merged, chunkResult);
      }

      const items = await searchDdbLibraryItems({
        sourceId,
        sourceIds: [sourceId],
        limit: 5000,
        ...importOpts,
      });
      const itemIds = items.map((item) => item.ddbId).filter((id) => Number.isFinite(id) && id > 0);
      for (const [i, chunk] of chunkIds(itemIds, DEFAULT_IMPORT_CHUNK).entries()) {
        onProgress?.({
          phase: 'items',
          sourceId,
          ...(sourceName ? { sourceName } : {}),
          done: Math.min((i + 1) * DEFAULT_IMPORT_CHUNK, itemIds.length),
          total: itemIds.length,
        });
        const chunkResult = await importDdbLibraryEntries(
          { kind: 'item', ids: chunk, sourceId, ...importOpts },
          { skipFinish: true },
        );
        bookMerged = mergeImportResults(bookMerged, chunkResult);
        merged = mergeImportResults(merged, chunkResult);
      }

      const fin = await finalizeBookImport(bookMerged, sourceId);
      finishedBooks.add(sourceId);
      applyFinishResult(merged, fin ?? { catalogRev: bookMerged.catalogRev ?? null });

      onProgress?.({
        phase: 'complete',
        sourceId,
        ...(sourceName ? { sourceName } : {}),
        done: 1,
        total: 1,
        bookImported: bookMerged.imported.length,
        bookErrors: bookMerged.errors.length,
      });

      await onBookComplete?.({
        sourceId,
        ...(sourceName ? { sourceName } : {}),
        result: bookMerged,
        catalogRev: fin?.catalogRev ?? bookMerged.catalogRev ?? null,
      });
    }
  } finally {
    const remainingIds = sourceIds.filter((id) => !finishedBooks.has(id));
    if (remainingIds.length > 0 && merged.imported.length > 0) {
      await finalizeImportedCompendium(merged, remainingIds);
    }
  }

  return merged;
}
