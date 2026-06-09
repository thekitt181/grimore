import { DDB_URLS } from './config';
import { authHeaders, type DdbAuthContext } from './ddbAuthContext';
import { stripDdbHtml } from './ddbHtml';

const MONSTER_BATCH_SIZE = 40;
const MONSTER_BATCH_CONCURRENCY = 4;
const MONSTER_DETAIL_CONCURRENCY = 8;

export async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  let idx = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      await fn(items[i]);
    }
  });
  await Promise.all(workers);
}

function monsterAuthHeaders(ctx: DdbAuthContext, ddbId?: number): Record<string, string> {
  const headers = authHeaders(ctx);
  headers.Referer = ddbId
    ? `https://www.dndbeyond.com/monsters/${ddbId}`
    : 'https://www.dndbeyond.com/monsters';
  return headers;
}

function unwrapMonsterPayload(json: unknown): Record<string, unknown> | null {
  if (!json || typeof json !== 'object') return null;
  const root = json as Record<string, unknown>;
  const data = root.data ?? root;
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
}

function pickRicherField(
  primary: Record<string, unknown>,
  secondary: Record<string, unknown>,
  key: string,
): void {
  const a = primary[key];
  const b = secondary[key];
  if (Array.isArray(b) && b.length > 0 && (!Array.isArray(a) || a.length === 0)) {
    primary[key] = b;
    return;
  }
  if (key === 'stats' && Array.isArray(a) && Array.isArray(b)) {
    const aOk = hasNonZeroAbilityScores({ stats: a });
    const bOk = hasNonZeroAbilityScores({ stats: b });
    if (bOk && !aOk) {
      primary[key] = b;
      return;
    }
  }
  const aText = stripDdbHtml(a);
  const bText = stripDdbHtml(b);
  if (bText.length > aText.length + 20) primary[key] = b;
  else if ((a == null || a === '' || a === 0) && b != null && b !== '' && b !== 0) {
    primary[key] = b;
  }
}

/** Merge batch/detail payloads, keeping the richest field values. */
export function mergeMonsterDetail(
  primary: Record<string, unknown>,
  secondary: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...primary };
  for (const key of [
    'stats',
    'savingThrows',
    'skills',
    'senses',
    'languages',
    'movements',
    'hitPointDice',
    'armorClass',
    'averageHitPoints',
    'passivePerception',
    'characteristicsDescription',
    'specialTraitsDescription',
    'actionsDescription',
    'bonusActionsDescription',
    'reactionsDescription',
    'legendaryActionsDescription',
    'mythicActionsDescription',
    'lairDescription',
    'languageDescription',
    'languageNote',
    'skillsHtml',
    'sensesHtml',
    'conditionImmunitiesHtml',
    'damageVulnerabilitiesDescription',
    'damageResistancesDescription',
    'damageImmunitiesDescription',
    'conditionImmunitiesDescription',
    'challengeRatingDescription',
    'armorClassDescription',
  ]) {
    pickRicherField(merged, secondary, key);
  }
  return merged;
}

function pickMonsterNumber(raw: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const v = raw[key];
    if (v == null || v === '') continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function hasNonZeroAbilityScores(raw: Record<string, unknown>): boolean {
  const stats = raw.stats;
  if (!Array.isArray(stats) || stats.length === 0) return false;
  for (const entry of stats) {
    if (!entry || typeof entry !== 'object') continue;
    const o = entry as Record<string, unknown>;
    const value = Number(o.value ?? o.score);
    if (Number.isFinite(value) && value > 0) return true;
  }
  return false;
}

function hasMeaningfulCombatStats(raw: Record<string, unknown>): boolean {
  const ac = pickMonsterNumber(raw, 'armorClass', 'ac');
  const hp = pickMonsterNumber(raw, 'averageHitPoints', 'hitPoints', 'hp');
  return ac != null && ac > 0 && hp != null && hp > 0;
}

function hasActionOrTraitContent(raw: Record<string, unknown>): boolean {
  for (const key of [
    'actionsDescription',
    'specialTraitsDescription',
    'bonusActionsDescription',
    'reactionsDescription',
    'legendaryActionsDescription',
  ]) {
    if (stripDdbHtml(raw[key]).length > 40) return true;
  }
  return false;
}

/** True when DDB payload has enough data for a usable stat block (strict — ignores placeholder 0 AC/HP). */
export function monsterHasFullStatBlock(raw: Record<string, unknown>): boolean {
  if (!hasMeaningfulCombatStats(raw)) return false;
  if (hasNonZeroAbilityScores(raw)) return true;
  if (hasActionOrTraitContent(raw)) return true;
  const characteristics = stripDdbHtml(raw.characteristicsDescription);
  if (characteristics.length > 120 && /hit points\s+\d+/i.test(characteristics)) return true;
  return false;
}

export function monsterHasImportableStatBlock(raw: Record<string, unknown>): boolean {
  return monsterHasFullStatBlock(raw);
}

export async function fetchDdbMonstersByIds(
  ctx: DdbAuthContext,
  ids: number[],
): Promise<Map<number, Record<string, unknown>>> {
  const unique = [...new Set(ids.filter((id) => Number.isFinite(id) && id > 0))];
  const out = new Map<number, Record<string, unknown>>();
  if (unique.length === 0) return out;

  const batches: number[][] = [];
  for (let i = 0; i < unique.length; i += MONSTER_BATCH_SIZE) {
    batches.push(unique.slice(i, i + MONSTER_BATCH_SIZE));
  }

  await runWithConcurrency(batches, MONSTER_BATCH_CONCURRENCY, async (batch) => {
    const res = await fetch(DDB_URLS.monstersByIds(batch), {
      headers: monsterAuthHeaders(ctx),
    });
    if (!res.ok) return;
    const json = (await res.json()) as Record<string, unknown>;
    const list = Array.isArray(json.data) ? json.data : [];
    for (const entry of list) {
      if (!entry || typeof entry !== 'object') continue;
      const monster = entry as Record<string, unknown>;
      const id = Number(monster.id);
      if (Number.isFinite(id) && id > 0) out.set(id, monster);
    }
  });

  return out;
}

async function fetchDdbMonsterDetailOnly(
  ctx: DdbAuthContext,
  ddbId: number,
): Promise<Record<string, unknown> | null> {
  const res = await fetch(DDB_URLS.monsterById(ddbId), {
    headers: monsterAuthHeaders(ctx, ddbId),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`DDB monster fetch failed (${res.status})`);
  return unwrapMonsterPayload(await res.json());
}

async function enrichMonsterRecord(
  ctx: DdbAuthContext,
  id: number,
  existing?: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  let merged = existing ?? null;

  if (!merged || !monsterHasFullStatBlock(merged)) {
    try {
      const detail = await fetchDdbMonsterDetailOnly(ctx, id);
      if (detail) {
        merged = merged ? mergeMonsterDetail(merged, detail) : detail;
      }
    } catch {
      // try batch fallback below
    }
  }

  if (!merged || !monsterHasFullStatBlock(merged)) {
    const batch = await fetchDdbMonstersByIds(ctx, [id]);
    const richer = batch.get(id);
    if (richer) {
      merged = merged ? mergeMonsterDetail(merged, richer) : richer;
    }
  }

  return merged;
}

/** Batch-fetch monsters for import; always detail-fetches entries missing a real stat block. */
export async function fetchMonstersForImport(
  ctx: DdbAuthContext,
  ids: number[],
): Promise<Map<number, Record<string, unknown>>> {
  const unique = [...new Set(ids.filter((id) => Number.isFinite(id) && id > 0))];
  const out = await fetchDdbMonstersByIds(ctx, unique);

  const needsDetail = unique.filter((id) => {
    const raw = out.get(id);
    return !raw || !monsterHasFullStatBlock(raw);
  });

  await runWithConcurrency(needsDetail, MONSTER_DETAIL_CONCURRENCY, async (id) => {
    const enriched = await enrichMonsterRecord(ctx, id, out.get(id));
    if (enriched) out.set(id, enriched);
  });

  return out;
}

export async function fetchDdbMonsterDetail(
  ctx: DdbAuthContext,
  ddbId: number,
): Promise<Record<string, unknown> | null> {
  const res = await fetch(DDB_URLS.monsterById(ddbId), {
    headers: monsterAuthHeaders(ctx, ddbId),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`DDB monster fetch failed (${res.status})`);

  let data = unwrapMonsterPayload(await res.json());
  if (!data) return null;

  const enriched = await enrichMonsterRecord(ctx, ddbId, data);
  return enriched ?? data;
}

export async function enrichMonstersForImport(
  ctx: DdbAuthContext,
  entries: Record<string, unknown>[],
): Promise<Record<string, unknown>[]> {
  const incompleteIds = entries
    .filter((entry) => !monsterHasFullStatBlock(entry))
    .map((entry) => Number(entry.id))
    .filter((id): id is number => Number.isFinite(id) && id > 0);

  if (incompleteIds.length === 0) return entries;

  const byId = new Map<number, Record<string, unknown>>();
  for (const entry of entries) {
    const id = Number(entry.id);
    if (Number.isFinite(id) && id > 0) byId.set(id, entry);
  }

  await runWithConcurrency(incompleteIds, MONSTER_DETAIL_CONCURRENCY, async (id) => {
    const enriched = await enrichMonsterRecord(ctx, id, byId.get(id));
    if (enriched) byId.set(id, enriched);
  });

  return entries.map((entry) => {
    const id = Number(entry.id);
    return Number.isFinite(id) && id > 0 ? (byId.get(id) ?? entry) : entry;
  });
}
