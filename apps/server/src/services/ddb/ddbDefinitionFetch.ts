import { DDB_URLS } from './config';
import { authHeaders, type DdbAuthContext } from './ddbAuthContext';
import { ddbEntityId } from './ddbContentNormalize';
import { stripDdbHtml } from './ddbHtml';
import { fetchWithRetry } from './ddbFetchRetry';
import { runWithConcurrency } from './ddbMonsterFetch';

const DEFINITION_BATCH_SIZE = 40;
const DEFINITION_BATCH_CONCURRENCY = 4;

const COLLECTION_PATHS: Record<'spell' | 'item', string[]> = {
  spell: ['spell/collection', 'spells/collection'],
  item: ['item/collection', 'items/collection'],
};

function pickNumber(...values: unknown[]): number | undefined {
  for (const v of values) {
    if (v == null || v === '') continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function unwrapDefinitionCollection(json: unknown): Record<string, unknown>[] {
  if (!json || typeof json !== 'object') return [];
  const root = json as Record<string, unknown>;
  if (root.success === false) return [];

  const data = root.data;
  if (data && typeof data === 'object') {
    const bucket = data as Record<string, unknown>;
    if (Array.isArray(bucket.definitionData)) return bucket.definitionData as Record<string, unknown>[];
    if (Array.isArray(bucket.data)) return bucket.data as Record<string, unknown>[];
  }
  if (Array.isArray(root.data)) return root.data as Record<string, unknown>[];
  return [];
}

function indexDefinitions(definitions: Record<string, unknown>[]): Map<number, Record<string, unknown>> {
  const byId = new Map<number, Record<string, unknown>>();
  for (const def of definitions) {
    const id = pickNumber(def.id, def.definitionId, def.entityId);
    if (id != null) byId.set(id, def);
  }
  return byId;
}

const DEFINITION_MERGE_KEYS = [
  'description',
  'fullDescription',
  'snippet',
  'summary',
  'details',
  'higherLevelDescription',
  'atHigherLevelsDescription',
  'higherLevelsDescription',
  'componentsDescription',
  'materialsDescription',
  'materialDescription',
  'attunementDescription',
  'flavor',
] as const;

/** Merge a full DDB definition payload into a game-data list entry. */
export function mergeEntityDefinition(
  raw: Record<string, unknown>,
  fullDef: Record<string, unknown>,
): Record<string, unknown> {
  const existing = ((raw.definition ?? raw) as Record<string, unknown>) ?? {};
  const mergedDef = { ...existing, ...fullDef };

  for (const key of DEFINITION_MERGE_KEYS) {
    const existingText = stripDdbHtml(existing[key]);
    const fullText = stripDdbHtml(fullDef[key]);
    if (fullText.length > existingText.length) {
      mergedDef[key] = fullDef[key];
    }
  }

  if (Array.isArray(fullDef.atHigherLevels) && !Array.isArray(mergedDef.atHigherLevels)) {
    mergedDef.atHigherLevels = fullDef.atHigherLevels;
  }
  if (Array.isArray(fullDef.properties) && (!Array.isArray(mergedDef.properties) || mergedDef.properties.length === 0)) {
    mergedDef.properties = fullDef.properties;
  }

  return { ...raw, definition: mergedDef };
}

export function entityNeedsDefinitionFetch(raw: Record<string, unknown>): boolean {
  const def = (raw.definition ?? raw) as Record<string, unknown>;
  const description = stripDdbHtml(def.description ?? def.details ?? def.fullDescription);
  if (description.length >= 120) return false;
  const snippet = stripDdbHtml(def.snippet ?? def.summary);
  return description.length < Math.max(80, snippet.length + 20);
}

async function postDefinitionCollection(
  ctx: DdbAuthContext,
  kind: 'spell' | 'item',
  ids: number[],
  campaignId?: number,
): Promise<Map<number, Record<string, unknown>>> {
  if (ids.length === 0) return new Map();

  const body = JSON.stringify({
    sharingSetting: 2,
    ids,
    ...(campaignId ? { campaignId } : {}),
  });

  for (const path of COLLECTION_PATHS[kind]) {
    const url = `${DDB_URLS.characterBase}/game-data/${path}`;
    const res = await fetchWithRetry(url, {
      method: 'POST',
      headers: {
        ...authHeaders(ctx),
        'Content-Type': 'application/json',
      },
      body,
    }, { label: `${kind} definitions (${ids.length})` });
    if (!res.ok) continue;

    const definitions = unwrapDefinitionCollection(await res.json());
    if (definitions.length > 0) return indexDefinitions(definitions);
  }

  return new Map();
}

/** Fetch full spell/item definitions from DDB collection API (batched). */
export async function fetchFullDefinitions(
  ctx: DdbAuthContext,
  kind: 'spell' | 'item',
  ids: number[],
  campaignId?: number,
): Promise<Map<number, Record<string, unknown>>> {
  const uniqueIds = [...new Set(ids.filter((id) => Number.isFinite(id) && id > 0))];
  const out = new Map<number, Record<string, unknown>>();
  if (uniqueIds.length === 0) return out;

  const batches: number[][] = [];
  for (let i = 0; i < uniqueIds.length; i += DEFINITION_BATCH_SIZE) {
    batches.push(uniqueIds.slice(i, i + DEFINITION_BATCH_SIZE));
  }

  await runWithConcurrency(batches, DEFINITION_BATCH_CONCURRENCY, async (batch) => {
    const chunk = await postDefinitionCollection(ctx, kind, batch, campaignId);
    for (const [id, def] of chunk) out.set(id, def);
  });

  return out;
}

export async function enrichEntitiesWithFullDefinitions(
  ctx: DdbAuthContext,
  kind: 'spell' | 'item',
  entries: Record<string, unknown>[],
  campaignId?: number,
  force = false,
): Promise<Record<string, unknown>[]> {
  const ids = entries
    .map((entry) => ddbEntityId(entry))
    .filter((id): id is number => id != null);

  const needsFetch = force || entries.some((entry) => entityNeedsDefinitionFetch(entry));
  if (!needsFetch) return entries;

  const definitions = await fetchFullDefinitions(ctx, kind, ids, campaignId);
  if (definitions.size === 0) return entries;

  return entries.map((entry) => {
    const id = ddbEntityId(entry);
    if (id == null) return entry;
    const fullDef = definitions.get(id);
    return fullDef ? mergeEntityDefinition(entry, fullDef) : entry;
  });
}

export async function enrichEntityForImport(
  ctx: DdbAuthContext,
  kind: 'spell' | 'item',
  raw: Record<string, unknown>,
  campaignId?: number,
): Promise<Record<string, unknown>> {
  const [enriched] = await enrichEntitiesWithFullDefinitions(ctx, kind, [raw], campaignId);
  return enriched ?? raw;
}
