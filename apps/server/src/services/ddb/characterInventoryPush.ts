import type { HandoutInventoryTarget, HandoutItemMeta } from '@grimoire/shared';
import {
  invalidateBearer,
  normalizeCobaltToken,
} from './cobaltAuth';
import { DDB_URLS } from './config';
import { fetchRawCharacter } from './characterExtract';
import { getDdbItemPool, searchDdbItems } from './ddbLibrary';
import { getDdbAuthContext, authHeaders, type DdbAuthContext } from './ddbAuthContext';

const INVENTORY_ITEM_URL = `${DDB_URLS.characterBase}/inventory/item`;
const CUSTOM_ITEM_URL = `${DDB_URLS.characterBase}/custom/item`;
const CONTAINER_ENTITY_TYPE_ID = 1581111423;
/** Campaign party stash container entity type for official inventory equipment arrays. */
const PARTY_CONTAINER_ENTITY_TYPE_ID = 1669830167;
/** Party equipment container for the custom/item API (DDB ContainerTypeEnum.CAMPAIGN). */
const PARTY_CUSTOM_CONTAINER_TYPE_ID = 618115330;
const VERIFY_DELAY_MS = 2000;

const CUSTOM_ITEM_MANUAL_MESSAGE =
  'This item is not in the D&D Beyond catalog. On dndbeyond.com open the character → Manage Equipment → Add Custom Item, then enter the handout name and description.';

const CUSTOM_PARTY_MANUAL_MESSAGE =
  'This item is not in the D&D Beyond catalog. On dndbeyond.com open any campaign character → Inventory → Party Inventory → Add Custom Item, then enter the handout details.';

const PARTY_WRONG_DEST_MESSAGE =
  'D&D Beyond added this to the character\'s personal inventory instead of party inventory. Move it manually: open the character → Inventory → Party Inventory.';

const PARTY_UNVERIFIED_MESSAGE =
  'Could not confirm party inventory from D&D Beyond. Check Inventory → Party Inventory on any campaign character; if the item is missing, add it there manually.';

export interface PushHandoutItemInput {
  name: string;
  description?: string;
  itemType?: string;
  rarity?: string;
  source?: string;
  isCustom?: boolean;
  ddbDefinitionId?: number;
}

export interface PushHandoutItemOptions {
  target?: HandoutInventoryTarget;
  /** D&D Beyond campaign id for party inventory pushes. */
  ddbCampaignId?: number;
}

type PushAttempt = {
  url: string;
  body: Record<string, unknown>;
};

type InventorySnapshot = {
  count: number;
  inventoryIds: Set<number>;
  definitionIds: Set<number>;
  namesLower: Set<string>;
  customNamesLower: Set<string>;
};

async function readDdbFailure(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  if (!text) return `HTTP ${res.status}`;
  try {
    const json = JSON.parse(text) as { message?: string; error?: string; success?: boolean };
    return json.message ?? json.error ?? text.slice(0, 240);
  } catch {
    return text.slice(0, 240);
  }
}

function inventoryName(row: Record<string, unknown>): string {
  const def = row.definition as Record<string, unknown> | undefined;
  return String(def?.name ?? row.name ?? '').trim();
}

function buildInventorySnapshot(raw: Record<string, unknown>): InventorySnapshot {
  const inventoryIds = new Set<number>();
  const definitionIds = new Set<number>();
  const namesLower = new Set<string>();

  const inv = raw.inventory;
  if (Array.isArray(inv)) {
    for (const entry of inv) {
      if (!entry || typeof entry !== 'object') continue;
      const row = entry as Record<string, unknown>;
      const id = Number(row.id);
      if (Number.isFinite(id) && id > 0) inventoryIds.add(id);

      const def = row.definition as Record<string, unknown> | undefined;
      const defId = Number(def?.id ?? row.definitionId);
      if (Number.isFinite(defId) && defId > 0) definitionIds.add(defId);

      const name = inventoryName(row).toLowerCase();
      if (name) namesLower.add(name);
    }
  }

  const customNamesLower = new Set<string>();
  const custom = raw.customItems;
  if (Array.isArray(custom)) {
    for (const entry of custom) {
      if (!entry || typeof entry !== 'object') continue;
      const name = String((entry as Record<string, unknown>).name ?? '').trim().toLowerCase();
      if (name) customNamesLower.add(name);
    }
  }

  return {
    count: Array.isArray(inv) ? inv.length : 0,
    inventoryIds,
    definitionIds,
    namesLower,
    customNamesLower,
  };
}

function inventoryContainsItem(
  before: InventorySnapshot,
  after: InventorySnapshot,
  item: PushHandoutItemInput,
  mode: 'official' | 'custom',
  definitionId: number | null,
): boolean {
  if (after.count > before.count) return true;

  const newInventoryIds = [...after.inventoryIds].filter((id) => !before.inventoryIds.has(id));
  if (newInventoryIds.length > 0) return true;

  if (mode === 'official' && definitionId && !before.definitionIds.has(definitionId)) {
    if (after.definitionIds.has(definitionId)) return true;
  }

  const targetName = item.name.trim().toLowerCase();
  if (!targetName) return false;

  if (mode === 'custom') {
    if (!before.customNamesLower.has(targetName) && after.customNamesLower.has(targetName)) return true;
    if (!before.namesLower.has(targetName) && after.namesLower.has(targetName)) return true;
    return false;
  }

  return !before.namesLower.has(targetName) && after.namesLower.has(targetName);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function ddbPost(
  ctx: DdbAuthContext,
  characterId: number,
  url: string,
  body: Record<string, unknown>,
  refreshBearer = false,
): Promise<Response> {
  let authCtx = ctx;
  if (refreshBearer) {
    await invalidateBearer(ctx.cacheId);
    const refreshed = await getDdbAuthContext(ctx.cobalt);
    if (!refreshed) return new Response(null, { status: 401 });
    authCtx = refreshed;
  }

  return fetch(url, {
    method: 'POST',
    headers: {
      ...authHeaders(authCtx, { characterId }),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

async function verifyPartyPushDidNotLandOnCharacter(
  ctx: DdbAuthContext,
  characterId: number,
  before: InventorySnapshot,
): Promise<boolean> {
  await sleep(VERIFY_DELAY_MS);
  const afterRaw = await fetchRawCharacter(ctx.cobalt, characterId);
  const after = buildInventorySnapshot(afterRaw);
  if (after.count > before.count) return false;
  const newInventoryIds = [...after.inventoryIds].filter((id) => !before.inventoryIds.has(id));
  return newInventoryIds.length === 0;
}

function partyAddItemDestination(
  addItems: unknown[] | undefined,
  characterId: number,
  partyCampaignId: number,
): 'party' | 'character' | 'unknown' {
  if (!Array.isArray(addItems) || addItems.length === 0) return 'unknown';
  const added = addItems[0] as Record<string, unknown>;
  const containerId = Number(added?.containerEntityId);
  if (containerId === partyCampaignId) return 'party';
  if (containerId === characterId) return 'character';
  const scope = String(added?.inventoryScope ?? added?.destination ?? '').toLowerCase();
  if (scope === 'party') return 'party';
  return 'unknown';
}

function usesCampaignPartyContainer(body: Record<string, unknown>, partyCampaignId: number): boolean {
  const equipment = body.equipment;
  if (!Array.isArray(equipment) || equipment.length === 0) return false;
  const row = equipment[0] as Record<string, unknown>;
  return Number(row.containerEntityId) === partyCampaignId
    && Number(row.containerEntityTypeId) === PARTY_CONTAINER_ENTITY_TYPE_ID;
}

async function tryPushAttempt(
  ctx: DdbAuthContext,
  characterId: number,
  before: InventorySnapshot,
  item: PushHandoutItemInput,
  mode: 'official' | 'custom',
  definitionId: number | null,
  attempt: PushAttempt,
  partyCampaignId?: number,
): Promise<{ ok: boolean; lastError: string }> {
  let res = await ddbPost(ctx, characterId, attempt.url, attempt.body);
  if (res.status === 401 || res.status === 403) {
    res = await ddbPost(ctx, characterId, attempt.url, attempt.body, true);
  }
  if (!res.ok) {
    const lastError = await readDdbFailure(res);
    console.warn(`[DDB] inventory push failed (${res.status}) ${attempt.url}: ${lastError}`);
    if (mode === 'custom') {
      return { ok: false, lastError: CUSTOM_ITEM_MANUAL_MESSAGE };
    }
    return { ok: false, lastError };
  }

  const json = (await res.json().catch(() => null)) as {
    success?: boolean;
    message?: string;
    data?: { addItems?: unknown[] } | null;
  } | null;
  if (json && 'success' in json && json.success === false) {
    const lastError = json.message ?? 'D&D Beyond returned success=false';
    console.warn(`[DDB] inventory push rejected ${attempt.url}: ${lastError}`);
    return { ok: false, lastError };
  }

  if (Array.isArray(json?.data?.addItems) && json.data.addItems.length > 0) {
    if (partyCampaignId) {
      const dest = partyAddItemDestination(json.data.addItems, characterId, partyCampaignId);
      if (dest === 'party') return { ok: true, lastError: '' };
      if (dest === 'character') return { ok: false, lastError: PARTY_WRONG_DEST_MESSAGE };
    } else {
      return { ok: true, lastError: '' };
    }
  }

  if (partyCampaignId) {
    const keptOffCharacter = await verifyPartyPushDidNotLandOnCharacter(ctx, characterId, before);
    if (!keptOffCharacter) {
      return { ok: false, lastError: PARTY_WRONG_DEST_MESSAGE };
    }
    if (usesCampaignPartyContainer(attempt.body, partyCampaignId)) {
      return { ok: true, lastError: '' };
    }
    return { ok: false, lastError: PARTY_UNVERIFIED_MESSAGE };
  }

  try {
    await sleep(VERIFY_DELAY_MS);
    const afterRaw = await fetchRawCharacter(ctx.cobalt, characterId);
    const after = buildInventorySnapshot(afterRaw);
    const verified = inventoryContainsItem(before, after, item, mode, definitionId);
    if (verified) return { ok: true, lastError: '' };
  } catch (err) {
    const lastError = err instanceof Error ? err.message : 'Could not verify inventory update';
    console.warn('[DDB] inventory verification failed:', lastError);
    return { ok: false, lastError };
  }

  return {
    ok: false,
    lastError: mode === 'custom'
      ? (partyCampaignId ? CUSTOM_PARTY_MANUAL_MESSAGE : CUSTOM_ITEM_MANUAL_MESSAGE)
      : 'D&D Beyond did not save this item automatically. On dndbeyond.com open the character → Manage Equipment, search for the item, and add it manually.',
  };
}

function isExplicitlyCustomItem(item: PushHandoutItemInput): boolean {
  if (item.isCustom === true) return true;
  const source = (item.source ?? '').trim().toLowerCase();
  return source === 'custom' || source === 'd&d beyond homebrew';
}

async function resolveDefinitionId(
  ctx: DdbAuthContext,
  item: PushHandoutItemInput,
  ddbCampaignId?: number,
): Promise<number | null> {
  if (item.ddbDefinitionId && item.ddbDefinitionId > 0) return item.ddbDefinitionId;
  if (item.isCustom) return null;

  const hits = await searchDdbItems(ctx, { q: item.name, limit: 20, campaignId: ddbCampaignId });
  const exact = hits.find((h) => h.name.trim().toLowerCase() === item.name.trim().toLowerCase());
  return exact?.ddbId ?? hits[0]?.ddbId ?? null;
}

async function resolveGameDataEntry(
  ctx: DdbAuthContext,
  definitionId: number,
  ddbCampaignId?: number,
): Promise<Record<string, unknown> | null> {
  const pool = await getDdbItemPool(ctx, ddbCampaignId);
  return pool.find((entry) => Number(entry.id) === definitionId) ?? null;
}

async function assertCharacterWritable(
  ctx: DdbAuthContext,
  characterId: number,
): Promise<{ ok: true; raw: Record<string, unknown> } | { ok: false; message: string }> {
  let raw: Record<string, unknown>;
  try {
    raw = await fetchRawCharacter(ctx.cobalt, characterId);
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : 'Cannot load character from D&D Beyond',
    };
  }

  const characterName = String(raw.name ?? 'this character').trim() || 'this character';
  if (raw.readonly === true || raw.canEdit === false) {
    return {
      ok: false,
      message: `${characterName} is read-only on D&D Beyond. Open the sheet on dndbeyond.com and confirm your campaign login can edit it, then try again.`,
    };
  }

  return { ok: true, raw };
}

function mapItemType(raw?: string): string {
  const value = (raw ?? '').trim();
  if (!value) return 'Wondrous Item';
  const lower = value.toLowerCase();
  if (lower.includes('weapon')) return 'Weapon';
  if (lower.includes('armor') || lower.includes('armour')) return 'Armor';
  if (lower.includes('potion')) return 'Potion';
  if (lower.includes('ring')) return 'Ring';
  if (lower.includes('rod')) return 'Rod';
  if (lower.includes('staff')) return 'Staff';
  if (lower.includes('wand')) return 'Wand';
  if (lower.includes('scroll')) return 'Scroll';
  if (lower.includes('trinket') || lower.includes('wondrous')) return 'Wondrous Item';
  return value;
}

function mapRarity(raw?: string): string {
  const value = (raw ?? '').trim();
  if (!value) return 'Common';
  const normalized = value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
  if (['Common', 'Uncommon', 'Rare', 'Very Rare', 'Legendary', 'Artifact'].includes(normalized)) {
    return normalized;
  }
  return 'Common';
}

function partyScopeFields(ddbCampaignId: number): Record<string, unknown> {
  return {
    campaignId: ddbCampaignId,
    destination: 'party',
    inventoryScope: 'party',
  };
}

function equipmentEntry(
  characterId: number,
  fields: Record<string, unknown>,
  partyCampaignId?: number,
): Record<string, unknown> {
  const base = {
    quantity: 1,
    originEntityId: null,
    originEntityTypeId: null,
    ...fields,
  };
  if (partyCampaignId) {
    return {
      ...base,
      containerEntityId: partyCampaignId,
      containerEntityTypeId: PARTY_CONTAINER_ENTITY_TYPE_ID,
    };
  }
  return {
    ...base,
    containerEntityId: characterId,
    containerEntityTypeId: CONTAINER_ENTITY_TYPE_ID,
  };
}

function containerDefinitionKey(entityTypeId: number, entityId: number): string {
  return `${entityTypeId}:${entityId}`;
}

function stripHandoutHtml(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function customItemText(item: PushHandoutItemInput): string {
  return stripHandoutHtml(item.description?.trim() ?? '');
}

/** DDB copies notes onto the inventory row — this is what players see on the sheet. */
function customItemNotes(item: PushHandoutItemInput): string | null {
  const body = customItemText(item);
  const meta = [item.itemType?.trim(), item.rarity?.trim()].filter(Boolean).join(' · ');
  if (body && meta) return `${meta}\n\n${body}`;
  return body || meta || null;
}

function customItemDescription(item: PushHandoutItemInput): string | null {
  const body = customItemText(item);
  return body || null;
}

function customItemPostBody(
  characterId: number,
  item: PushHandoutItemInput,
  partyCampaignId?: number,
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    characterId,
    name: item.name.trim(),
    description: customItemDescription(item),
    quantity: 1,
    cost: null,
    weight: null,
    notes: customItemNotes(item),
  };

  if (partyCampaignId) {
    return {
      ...base,
      containerDefinitionKey: containerDefinitionKey(PARTY_CUSTOM_CONTAINER_TYPE_ID, partyCampaignId),
      containerEntityId: partyCampaignId,
      containerEntityTypeId: PARTY_CUSTOM_CONTAINER_TYPE_ID,
      partyId: partyCampaignId,
    };
  }

  return {
    ...base,
    containerDefinitionKey: containerDefinitionKey(CONTAINER_ENTITY_TYPE_ID, characterId),
    containerEntityId: characterId,
    containerEntityTypeId: CONTAINER_ENTITY_TYPE_ID,
  };
}

function inventoryPostBody(
  characterId: number,
  equipment: Record<string, unknown>[],
  partyCampaignId?: number,
): Record<string, unknown> {
  if (partyCampaignId) {
    return {
      characterId,
      ...partyScopeFields(partyCampaignId),
      equipment,
    };
  }
  return { characterId, equipment };
}

function flatOfficialPartyBody(
  characterId: number,
  definitionId: number,
  gameData: Record<string, unknown> | null,
  partyCampaignId: number,
): Record<string, unknown> {
  const entityTypeId = Number(gameData?.entityTypeId ?? 112130694);
  return {
    characterId,
    ...partyScopeFields(partyCampaignId),
    definitionId,
    entityTypeId: Number.isFinite(entityTypeId) && entityTypeId > 0 ? entityTypeId : 112130694,
    quantity: 1,
    equipped: false,
  };
}
async function tryPushCustomItem(
  ctx: DdbAuthContext,
  characterId: number,
  before: InventorySnapshot,
  item: PushHandoutItemInput,
  partyCampaignId?: number,
): Promise<{ ok: boolean; lastError: string }> {
  const body = customItemPostBody(characterId, item, partyCampaignId);
  let res = await ddbPost(ctx, characterId, CUSTOM_ITEM_URL, body);
  if (res.status === 401 || res.status === 403) {
    res = await ddbPost(ctx, characterId, CUSTOM_ITEM_URL, body, true);
  }

  if (!res.ok) {
    const detail = await readDdbFailure(res);
    console.warn(`[DDB] custom item push failed (${res.status}): ${detail}`);
    return {
      ok: false,
      lastError: partyCampaignId ? CUSTOM_PARTY_MANUAL_MESSAGE : CUSTOM_ITEM_MANUAL_MESSAGE,
    };
  }

  const json = (await res.json().catch(() => null)) as {
    success?: boolean;
    message?: string;
    data?: { id?: number; name?: string } | null;
  } | null;

  if (json && 'success' in json && json.success === false) {
    const lastError = json.message ?? 'D&D Beyond rejected the custom item';
    console.warn(`[DDB] custom item push rejected: ${lastError}`);
    return {
      ok: false,
      lastError: partyCampaignId ? CUSTOM_PARTY_MANUAL_MESSAGE : CUSTOM_ITEM_MANUAL_MESSAGE,
    };
  }

  const createdId = Number(json?.data?.id);
  const apiConfirmed = Number.isFinite(createdId) && createdId > 0
    || /successfully added/i.test(String(json?.message ?? ''));

  if (apiConfirmed) {
    try {
      await sleep(VERIFY_DELAY_MS);
      const afterRaw = await fetchRawCharacter(ctx.cobalt, characterId);
      const after = buildInventorySnapshot(afterRaw);
      if (inventoryContainsItem(before, after, item, 'custom', null)) {
        return { ok: true, lastError: '' };
      }
    } catch (err) {
      const lastError = err instanceof Error ? err.message : 'Could not verify custom item';
      console.warn('[DDB] custom item verification failed:', lastError);
    }
    if (Number.isFinite(createdId) && createdId > 0) {
      return { ok: true, lastError: '' };
    }
  }

  return {
    ok: false,
    lastError: partyCampaignId ? CUSTOM_PARTY_MANUAL_MESSAGE : CUSTOM_ITEM_MANUAL_MESSAGE,
  };
}

function officialItemBody(
  characterId: number,
  definitionId: number,
  gameData: Record<string, unknown> | null,
  partyCampaignId?: number,
): Record<string, unknown> {
  const entityTypeId = Number(gameData?.entityTypeId ?? 112130694);
  return inventoryPostBody(characterId, [
    equipmentEntry(
      characterId,
      {
        entityId: definitionId,
        entityTypeId: Number.isFinite(entityTypeId) && entityTypeId > 0 ? entityTypeId : 112130694,
      },
      partyCampaignId,
    ),
  ], partyCampaignId);
}

async function pushInventoryItem(
  ctx: DdbAuthContext,
  characterId: number,
  item: PushHandoutItemInput,
  treatAsCustom: boolean,
  gameDataCampaignId?: number,
  partyCampaignId?: number,
): Promise<{ ok: boolean; mode: 'official' | 'custom' | 'failed'; lastError: string }> {
  const access = await assertCharacterWritable(ctx, characterId);
  if (!access.ok) return { ok: false, mode: 'failed', lastError: access.message };

  const before = buildInventorySnapshot(access.raw);

  if (item.isCustom) {
    const custom = await tryPushCustomItem(ctx, characterId, before, item, partyCampaignId);
    return {
      ok: custom.ok,
      mode: custom.ok ? 'custom' : 'failed',
      lastError: custom.lastError,
    };
  }

  const explicitlyCustom = isExplicitlyCustomItem(item);
  const definitionId = await resolveDefinitionId(ctx, item, gameDataCampaignId);

  if (definitionId) {
    const gameData = await resolveGameDataEntry(ctx, definitionId, gameDataCampaignId);
    const officialBodies: Record<string, unknown>[] = [
      officialItemBody(characterId, definitionId, gameData, partyCampaignId),
    ];
    if (partyCampaignId) {
      officialBodies.push(flatOfficialPartyBody(characterId, definitionId, gameData, partyCampaignId));
    }

    let lastError = '';
    for (const body of officialBodies) {
      const official = await tryPushAttempt(
        ctx,
        characterId,
        before,
        item,
        'official',
        definitionId,
        { url: INVENTORY_ITEM_URL, body },
        partyCampaignId,
      );
      if (official.ok) return { ok: true, mode: 'official', lastError: '' };
      lastError = official.lastError;
    }

    if (!explicitlyCustom) {
      return { ok: false, mode: 'failed', lastError: lastError || PARTY_UNVERIFIED_MESSAGE };
    }
  }

  const custom = await tryPushCustomItem(ctx, characterId, before, item, partyCampaignId);
  return {
    ok: custom.ok,
    mode: custom.ok ? 'custom' : 'failed',
    lastError: custom.lastError,
  };
}

/** Best-effort push of a handout item card onto a D&D Beyond character or party inventory. */
export async function pushHandoutItemToDdb(
  cobalt: string,
  characterId: number,
  item: PushHandoutItemInput,
  opts?: PushHandoutItemOptions,
): Promise<{ ok: boolean; mode: 'official' | 'custom' | 'failed'; message?: string }> {
  const name = item.name.trim();
  if (!name) return { ok: false, mode: 'failed', message: 'Item name is required' };

  const token = normalizeCobaltToken(cobalt);
  const ctx = await getDdbAuthContext(token);
  if (!ctx) {
    return {
      ok: false,
      mode: 'failed',
      message: 'D&D Beyond session expired — re-link your CobaltSession cookie in Settings.',
    };
  }

  const target = opts?.target ?? 'character';
  const ddbCampaignId = opts?.ddbCampaignId;
  if (target === 'party' && (!ddbCampaignId || ddbCampaignId <= 0)) {
    return {
      ok: false,
      mode: 'failed',
      message: 'Link this Grimoire campaign to a D&D Beyond campaign to use party inventory.',
    };
  }

  const explicitlyCustom = isExplicitlyCustomItem(item);

  try {
    const gameDataCampaignId = ddbCampaignId;
    const partyId = target === 'party' ? ddbCampaignId : undefined;
    const result = await pushInventoryItem(ctx, characterId, item, explicitlyCustom, gameDataCampaignId, partyId);
    if (result.ok) {
      const targetLabel = target === 'party' ? 'party inventory' : 'character sheet';
      return {
        ok: true,
        mode: result.mode,
        message: result.mode === 'official'
          ? `Official D&D Beyond item added to your ${targetLabel}.`
          : `Custom item added to your ${targetLabel}.`,
      };
    }

    const hint = result.lastError.includes('401') || result.lastError.includes('403')
      ? ' Re-link your D&D Beyond account (CobaltSession cookie may have expired).'
      : '';

    return {
      ok: false,
      mode: 'failed',
      message: `${result.lastError}${hint}`,
    };
  } catch (err) {
    return {
      ok: false,
      mode: 'failed',
      message: err instanceof Error ? err.message : 'Inventory push failed',
    };
  }
}

export function normalizeHandoutItemName(raw: string): string {
  return raw
    .replace(/^[\s•·▪▫◦‣⁃\-–—*+>]+/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function handoutItemMetaToPushInput(
  meta: HandoutItemMeta | null,
  title: string,
  content?: string | null,
): PushHandoutItemInput {
  const source = meta?.source?.trim();
  const hasDdbDefinition = Boolean(meta?.ddbDefinitionId && meta.ddbDefinitionId > 0);
  // Without a DDB definition id, handout items are custom unless explicitly marked official.
  const isCustom = meta?.isCustom === true
    || (!hasDdbDefinition && meta?.isCustom !== false);

  return {
    name: normalizeHandoutItemName(meta?.name?.trim() || title),
    description: content ?? undefined,
    itemType: meta?.itemType,
    rarity: meta?.rarity,
    source,
    isCustom,
    ddbDefinitionId: meta?.ddbDefinitionId ?? undefined,
  };
}
