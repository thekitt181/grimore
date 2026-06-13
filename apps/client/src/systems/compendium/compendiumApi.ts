import { api } from '@/lib/axios';
import type {
  CompendiumEntryImageState,
  CompendiumImageKind,
  CompendiumItem,
  CompendiumMonster,
  CompendiumSearchResult,
  CompendiumSource,
  CompendiumSpell,
  CompendiumSyncStatus,
  CompendiumSaveAs,
  CompendiumVisibilityPolicy,
  OwlbearItem,
  OwlbearMonster,
  OwlbearSpell,
} from '@grimoire/shared';

export async function fetchSyncStatus(): Promise<CompendiumSyncStatus> {
  const { data } = await api.get<CompendiumSyncStatus>('/compendium/sync-status');
  return data;
}

export async function reconcileCompendiumMongo(opts?: {
  reason?: string;
  deferCatalogRebuild?: boolean;
  strict?: boolean;
}): Promise<CompendiumSyncStatus> {
  const { data } = await api.post<CompendiumSyncStatus>('/compendium/reconcile-mongo', {
    reason: opts?.reason ?? 'client-reconcile',
    deferCatalogRebuild: opts?.deferCatalogRebuild ?? true,
    strict: opts?.strict ?? false,
  });
  return data;
}

export async function fetchAdminConfigured(): Promise<{ configured: boolean }> {
  const { data } = await api.get<{ configured: boolean }>('/compendium/admin/configured');
  return data;
}

export async function verifyCompendiumAdminPassword(password: string): Promise<boolean> {
  try {
    const { data } = await api.post<{ ok: boolean }>('/compendium/admin/verify', { password });
    return Boolean(data.ok);
  } catch {
    return false;
  }
}

export async function fetchVisibilityPolicy(): Promise<CompendiumVisibilityPolicy> {
  const { data } = await api.get<CompendiumVisibilityPolicy>('/compendium/admin/visibility-policy');
  return data;
}

export async function lockCompendiumSource(sourceLabel: string): Promise<CompendiumVisibilityPolicy> {
  const { data } = await api.post<CompendiumVisibilityPolicy>('/compendium/admin/sources/lock', { sourceLabel });
  return data;
}

export async function unlockCompendiumSource(sourceLabel: string): Promise<CompendiumVisibilityPolicy> {
  const { data } = await api.post<CompendiumVisibilityPolicy>('/compendium/admin/sources/unlock', { sourceLabel });
  return data;
}

export async function publishCompendiumEntry(
  kind: 'monster' | 'item' | 'spell',
  name: string,
): Promise<CompendiumVisibilityPolicy> {
  const { data } = await api.post<CompendiumVisibilityPolicy>('/compendium/admin/entries/publish', { kind, name });
  return data;
}

export async function unpublishCompendiumEntry(
  kind: 'monster' | 'item' | 'spell',
  name: string,
): Promise<CompendiumVisibilityPolicy> {
  const { data } = await api.post<CompendiumVisibilityPolicy>('/compendium/admin/entries/unpublish', { kind, name });
  return data;
}

export async function fetchSources(
  kind: 'monsters' | 'items' | 'spells',
  opts?: { books?: boolean },
): Promise<CompendiumSource[]> {
  const { data } = await api.get<CompendiumSource[]>('/compendium/sources', {
    params: { kind, ...(opts?.books ? { books: '1' } : {}) },
  });
  return data;
}

/** All imported DDB books for a single compendium kind (monsters, items, or spells). */
export async function fetchBookSources(
  kind: 'monsters' | 'items' | 'spells',
): Promise<CompendiumSource[]> {
  return fetchSources(kind, { books: true });
}

export async function searchMonsters(params: {
  q?: string;
  page?: number;
  limit?: number;
  crMin?: number;
  crMax?: number;
  isCustom?: boolean;
  source?: string;
}): Promise<CompendiumSearchResult<CompendiumMonster>> {
  const { data } = await api.get('/compendium/monsters', { params });
  return data;
}

export async function getMonster(id: string): Promise<CompendiumMonster> {
  const { data } = await api.get(`/compendium/monsters/${encodeURIComponent(id)}`);
  return data;
}

export async function saveMonster(id: string, patch: Partial<OwlbearMonster> & { saveAs?: CompendiumSaveAs }): Promise<CompendiumMonster> {
  const { data } = await api.patch(`/compendium/monsters/${encodeURIComponent(id)}`, patch);
  return data;
}

export async function createMonster(body: OwlbearMonster): Promise<CompendiumMonster> {
  const { data } = await api.post<CompendiumMonster>('/compendium/monsters', body);
  return data;
}

export async function deleteMonster(id: string): Promise<void> {
  await api.delete(`/compendium/monsters/${encodeURIComponent(id)}`);
}

export async function searchItems(params: {
  q?: string;
  page?: number;
  limit?: number;
  isCustom?: boolean;
  source?: string;
}): Promise<CompendiumSearchResult<CompendiumItem>> {
  const { data } = await api.get('/compendium/items', { params });
  return data;
}

export async function getItem(id: string): Promise<CompendiumItem> {
  const { data } = await api.get(`/compendium/items/${encodeURIComponent(id)}`);
  return data;
}

export async function saveItem(id: string, patch: Partial<OwlbearItem> & { saveAs?: CompendiumSaveAs }): Promise<CompendiumItem> {
  const { data } = await api.patch(`/compendium/items/${encodeURIComponent(id)}`, patch);
  return data;
}

export async function createItem(body: OwlbearItem): Promise<CompendiumItem> {
  const { data } = await api.post<CompendiumItem>('/compendium/items', body);
  return data;
}

export async function deleteItem(id: string): Promise<void> {
  await api.delete(`/compendium/items/${encodeURIComponent(id)}`);
}

export async function searchSpells(params: {
  q?: string;
  page?: number;
  limit?: number;
  isCustom?: boolean;
  source?: string;
}): Promise<CompendiumSearchResult<CompendiumSpell>> {
  const { data } = await api.get('/compendium/spells', { params });
  return data;
}

export async function getSpell(id: string): Promise<CompendiumSpell> {
  const { data } = await api.get(`/compendium/spells/${encodeURIComponent(id)}`);
  return data;
}

export async function saveSpell(id: string, patch: Partial<OwlbearSpell> & { saveAs?: CompendiumSaveAs }): Promise<CompendiumSpell> {
  const { data } = await api.patch(`/compendium/spells/${encodeURIComponent(id)}`, patch);
  return data;
}

export async function createSpell(body: OwlbearSpell): Promise<CompendiumSpell> {
  const { data } = await api.post<CompendiumSpell>('/compendium/spells', body);
  return data;
}

export async function deleteSpell(id: string): Promise<void> {
  await api.delete(`/compendium/spells/${encodeURIComponent(id)}`);
}

function imagePath(kind: CompendiumImageKind, id: string): string {
  const base = kind === 'monster' ? 'monsters' : kind === 'item' ? 'items' : 'spells';
  return `/compendium/${base}/${encodeURIComponent(id)}/images`;
}

export async function getEntryImages(
  kind: CompendiumImageKind,
  id: string,
): Promise<CompendiumEntryImageState> {
  const { data } = await api.get<CompendiumEntryImageState>(imagePath(kind, id));
  return data;
}

export async function saveEntryImages(
  kind: CompendiumImageKind,
  id: string,
  imageUrl: string | null,
): Promise<CompendiumEntryImageState> {
  const { data } = await api.put<CompendiumEntryImageState>(imagePath(kind, id), { imageUrl });
  return data;
}
