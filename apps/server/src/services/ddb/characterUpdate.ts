import {
  cobaltCacheId,
  ddbAuthHeaders,
  getBearerToken,
  invalidateBearer,
  normalizeCobaltToken,
} from './cobaltAuth';
import { DDB_URLS } from './config';
import { fetchRawCharacter } from './characterExtract';
import { extractVitals } from './vitalsExtract';

const HP_UPDATE_URL = `${DDB_URLS.characterBase}/life/hp/damage-taken`;
const DEATH_SAVE_URL = `${DDB_URLS.characterBase}/life/death-saves`;
const LIMITED_USE_URL = `${DDB_URLS.characterBase}/action/limited-use`;
const SPELL_SLOTS_URL = `${DDB_URLS.characterBase}/spell/slots`;
const PACT_MAGIC_URL = `${DDB_URLS.characterBase}/spell/pact-magic`;
const REST_LONG_URL = `${DDB_URLS.characterBase}/character/rest/long`;
const REST_SHORT_URL = `${DDB_URLS.characterBase}/character/rest/short`;
const CURRENCY_URL = `${DDB_URLS.characterBase}/inventory/currency`;
const GOLD_URL = `${DDB_URLS.characterBase}/inventory/currency/gold`;

function restApplyUrl(kind: 'short' | 'long'): string {
  return kind === 'short' ? REST_SHORT_URL : REST_LONG_URL;
}

function restSucceeded(res: Response, json: { success?: boolean } | null): boolean {
  if (!res.ok) return false;
  if (json && 'success' in json && json.success === false) return false;
  const type = res.headers.get('content-type') ?? '';
  if (type.includes('text/html')) return false;
  return true;
}

async function readDdbJson(res: Response): Promise<{ success?: boolean } | null> {
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('json')) return null;
  return (await res.clone().json().catch(() => null)) as { success?: boolean } | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function limitedUseRecovers(resetType: unknown, kind: 'short' | 'long'): boolean {
  const n = Number(resetType);
  if (kind === 'short') return n === 1;
  if (n === 4 || n === 5) return false;
  return true;
}

export interface DdbDeathSavesPayload {
  successes: number;
  failures: number;
  stabilized?: boolean;
}

async function requestDeathSaveUpdate(
  cobalt: string,
  characterId: number,
  deathSaves: DdbDeathSavesPayload,
  refreshBearer = false,
): Promise<Response> {
  const token = normalizeCobaltToken(cobalt);
  const cacheId = cobaltCacheId(token);
  if (refreshBearer) await invalidateBearer(cacheId);

  const bearer = await getBearerToken(cacheId, token);
  if (!bearer) return new Response(null, { status: 401 });

  return fetch(DEATH_SAVE_URL, {
    method: 'PUT',
    headers: {
      ...ddbAuthHeaders(token, bearer, { characterId }),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      characterId,
      successCount: Math.max(0, Math.min(3, deathSaves.successes)),
      failCount: Math.max(0, Math.min(3, deathSaves.failures)),
      isStabilized: Boolean(deathSaves.stabilized),
    }),
  });
}

async function requestHpUpdate(
  cobalt: string,
  characterId: number,
  body: { characterId: number; removedHitPoints: number; temporaryHitPoints: number },
  refreshBearer = false,
): Promise<Response> {
  const token = normalizeCobaltToken(cobalt);
  const cacheId = cobaltCacheId(token);
  if (refreshBearer) await invalidateBearer(cacheId);

  const bearer = await getBearerToken(cacheId, token);
  if (!bearer) return new Response(null, { status: 401 });

  return fetch(HP_UPDATE_URL, {
    method: 'PUT',
    headers: {
      ...ddbAuthHeaders(token, bearer, { characterId }),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

/** Best-effort HP push to D&D Beyond (unofficial API). */
export async function pushHpToDdb(
  cobalt: string,
  characterId: number,
  hp: number,
  tempHp: number,
): Promise<boolean> {
  try {
    const raw = await fetchRawCharacter(cobalt, characterId);
    const { maxHp } = extractVitals(raw);
    const removedHitPoints = Math.max(0, Math.min(maxHp, maxHp - hp));

    const body = {
      characterId,
      removedHitPoints,
      temporaryHitPoints: Math.max(0, tempHp),
    };

    let res = await requestHpUpdate(cobalt, characterId, body);
    if (res.status === 401 || res.status === 403) {
      res = await requestHpUpdate(cobalt, characterId, body, true);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn(`[DDB] HP push failed (${res.status}): ${text.slice(0, 300)}`);
      return false;
    }

    const json = (await res.json().catch(() => null)) as { success?: boolean; message?: string } | null;
    if (json && 'success' in json && json.success === false) {
      console.warn(`[DDB] HP push rejected: ${json.message ?? 'unknown error'}`);
      return false;
    }

    return true;
  } catch (err) {
    console.warn('[DDB] HP push error:', err instanceof Error ? err.message : err);
    return false;
  }
}

/** Best-effort death save push to D&D Beyond (unofficial API). */
export async function pushDeathSavesToDdb(
  cobalt: string,
  characterId: number,
  deathSaves: DdbDeathSavesPayload,
): Promise<boolean> {
  try {
    let res = await requestDeathSaveUpdate(cobalt, characterId, deathSaves);
    if (res.status === 401 || res.status === 403) {
      res = await requestDeathSaveUpdate(cobalt, characterId, deathSaves, true);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn(`[DDB] death save push failed (${res.status}): ${text.slice(0, 300)}`);
      return false;
    }

    const json = (await res.json().catch(() => null)) as { success?: boolean; message?: string } | null;
    if (json && 'success' in json && json.success === false) {
      console.warn(`[DDB] death save push rejected: ${json.message ?? 'unknown error'}`);
      return false;
    }

    return true;
  } catch (err) {
    console.warn('[DDB] death save push error:', err instanceof Error ? err.message : err);
    return false;
  }
}

async function ddbAuthedFetch(
  cobalt: string,
  characterId: number,
  url: string,
  init: { method: string; body?: string },
  refreshBearer = false,
): Promise<Response> {
  const token = normalizeCobaltToken(cobalt);
  const cacheId = cobaltCacheId(token);
  if (refreshBearer) await invalidateBearer(cacheId);
  const bearer = await getBearerToken(cacheId, token);
  if (!bearer) return new Response(null, { status: 401 });
  return fetch(url, {
    method: init.method,
    headers: {
      ...ddbAuthHeaders(token, bearer, { characterId }),
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(init.body ? { body: init.body } : {}),
  });
}

async function ddbAuthedOk(
  cobalt: string,
  characterId: number,
  url: string,
  init: { method: string; body?: string },
): Promise<boolean> {
  let res = await ddbAuthedFetch(cobalt, characterId, url, init);
  if (res.status === 401 || res.status === 403) {
    res = await ddbAuthedFetch(cobalt, characterId, url, init, true);
  }
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 800));
    res = await ddbAuthedFetch(cobalt, characterId, url, init);
  }
  const json = await readDdbJson(res);
  const ok = restSucceeded(res, json);
  if (!ok) {
    const text = json
      ? JSON.stringify(json).slice(0, 240)
      : await res.text().catch(() => '');
    console.warn(`[DDB] ${init.method} ${url} failed (${res.status}): ${text.slice(0, 240)}`);
  }
  return ok;
}

function collectLimitedUseTargets(raw: Record<string, unknown>): Array<{
  id: string;
  entityTypeId: string;
  resetType: unknown;
}> {
  const out: Array<{ id: string; entityTypeId: string; resetType: unknown }> = [];
  const seen = new Set<string>();

  const pushRow = (row: unknown) => {
    const r = asRecord(row);
    if (!r) return;
    const lu = asRecord(r.limitedUse) ?? asRecord(asRecord(r.definition)?.limitedUse);
    if (!lu) return;
    const used = Number(lu.numberUsed ?? lu.used ?? r.numberUsed ?? 0);
    if (!Number.isFinite(used) || used <= 0) return;
    const id = r.id ?? r.componentId;
    const entityTypeId = r.entityTypeId ?? r.componentTypeId ?? asRecord(r.definition)?.entityTypeId;
    if (id == null || entityTypeId == null) return;
    const key = `${id}:${entityTypeId}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ id: String(id), entityTypeId: String(entityTypeId), resetType: lu.resetType });
  };

  const actions = asRecord(raw.actions);
  if (actions) {
    for (const list of Object.values(actions)) {
      if (Array.isArray(list)) list.forEach(pushRow);
    }
  }
  for (const key of ['classFeatures', 'feats', 'inventory', 'customItems']) {
    const list = raw[key];
    if (Array.isArray(list)) list.forEach(pushRow);
  }
  const classes = raw.classes;
  if (Array.isArray(classes)) {
    for (const cls of classes) {
      const features = asRecord(cls)?.classFeatures;
      if (Array.isArray(features)) features.forEach(pushRow);
    }
  }
  return out;
}

function collectUsedSpellLevels(pool: unknown): number[] {
  const levels = new Set<number>();
  if (Array.isArray(pool)) {
    pool.forEach((row, i) => {
      const r = asRecord(row);
      if (!r) return;
      const used = Number(r.used ?? r.numberUsed ?? 0);
      if (used <= 0) return;
      const level = Number(r.level ?? i);
      if (level >= 1 && level <= 9) levels.add(level);
    });
    return [...levels];
  }
  const obj = asRecord(pool);
  if (!obj) return [];
  for (const [key, row] of Object.entries(obj)) {
    const r = asRecord(row);
    if (!r) continue;
    const used = Number(r.used ?? r.numberUsed ?? 0);
    if (used <= 0) continue;
    const fromKey = String(key).replace(/\D/g, '') || key;
    const level = Number(r.level ?? fromKey);
    if (level >= 1 && level <= 9) levels.add(level);
  }
  return [...levels];
}

async function resetSpentResourcesOnDdb(
  cobalt: string,
  characterId: number,
  kind: 'short' | 'long',
): Promise<boolean> {
  let raw: Record<string, unknown>;
  try {
    raw = await fetchRawCharacter(cobalt, characterId);
  } catch {
    return false;
  }

  let any = false;
  for (const target of collectLimitedUseTargets(raw)) {
    if (!limitedUseRecovers(target.resetType, kind)) continue;
    const ok = await ddbAuthedOk(cobalt, characterId, LIMITED_USE_URL, {
      method: 'PUT',
      body: JSON.stringify({
        characterId,
        id: String(target.id),
        entityTypeId: String(target.entityTypeId),
        uses: 0,
      }),
    });
    if (ok) any = true;
  }

  const slotLevels = kind === 'long'
    ? collectUsedSpellLevels(raw.spellSlots)
    : [];
  for (const level of slotLevels) {
    const ok = await ddbAuthedOk(cobalt, characterId, SPELL_SLOTS_URL, {
      method: 'PUT',
      body: JSON.stringify({ characterId, [`level${level}`]: 0 }),
    });
    if (ok) any = true;
  }

  const pactLevels = collectUsedSpellLevels(raw.pactMagic);
  if (kind === 'long' || kind === 'short') {
    for (const level of pactLevels) {
      const ok = await ddbAuthedOk(cobalt, characterId, PACT_MAGIC_URL, {
        method: 'PUT',
        body: JSON.stringify({ characterId, used: 0, [`level${level}`]: 0 }),
      });
      if (ok) any = true;
    }
  }

  return any;
}

function classHitDiceUsedFromRaw(raw: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  const classes = raw.classes;
  if (!Array.isArray(classes)) return out;
  for (const cls of classes) {
    const row = asRecord(cls);
    if (!row || row.id == null) continue;
    out[String(row.id)] = Math.max(0, Number(row.hitDiceUsed ?? 0) || 0);
  }
  return out;
}

async function postRestToDdb(
  cobalt: string,
  characterId: number,
  kind: 'short' | 'long',
): Promise<boolean> {
  const url = restApplyUrl(kind);
  let body: Record<string, unknown> = { characterId };
  if (kind === 'short') {
    let raw: Record<string, unknown> | null = null;
    try {
      raw = await fetchRawCharacter(cobalt, characterId);
    } catch {
      raw = null;
    }
    body = {
      characterId,
      classHitDiceUsed: raw ? classHitDiceUsedFromRaw(raw) : {},
      resetMaxHpModifier: false,
    };
  }
  const ok = await ddbAuthedOk(cobalt, characterId, url, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (ok) {
    console.info(`[DDB] ${kind} rest POST ok for character ${characterId}`);
  }
  return ok;
}

/** Short/long rest on D&D Beyond. GET rest/long|short is a preview (200, no writes). */
export async function pushRestToDdb(
  cobalt: string,
  characterId: number,
  kind: 'short' | 'long',
): Promise<boolean> {
  try {
    const restored = await postRestToDdb(cobalt, characterId, kind);
    const swept = restored ? false : await resetSpentResourcesOnDdb(cobalt, characterId, kind);
    if (restored || swept) return true;
    console.warn(`[DDB] rest push failed for ${kind} rest on character ${characterId}`);
    return false;
  } catch (err) {
    console.warn('[DDB] rest push error:', err instanceof Error ? err.message : err);
    return false;
  }
}

function readCurrencies(raw: Record<string, unknown>): {
  cp: number;
  sp: number;
  ep: number;
  gp: number;
  pp: number;
} {
  const c = asRecord(raw.currencies) ?? {};
  const n = (key: string) => Math.max(0, Math.floor(Number(c[key] ?? 0) || 0));
  return { cp: n('cp'), sp: n('sp'), ep: n('ep'), gp: n('gp'), pp: n('pp') };
}

export type DdbCoinPurse = {
  cp: number;
  sp: number;
  ep: number;
  gp: number;
  pp: number;
};

function coinDelta(n: number): number {
  return Number.isFinite(n) ? Math.floor(n) : 0;
}

/** Add coins to the live D&D Beyond pouch (not a custom inventory item). */
export async function pushCurrencyDeltaToDdb(
  cobalt: string,
  characterId: number,
  delta: Partial<DdbCoinPurse>,
): Promise<{ ok: boolean; error?: string }> {
  const add: DdbCoinPurse = {
    cp: coinDelta(delta.cp ?? 0),
    sp: coinDelta(delta.sp ?? 0),
    ep: coinDelta(delta.ep ?? 0),
    gp: coinDelta(delta.gp ?? 0),
    pp: coinDelta(delta.pp ?? 0),
  };
  if (add.cp + add.sp + add.ep + add.gp + add.pp <= 0) return { ok: true };
  try {
    const raw = await fetchRawCharacter(cobalt, characterId);
    const before = readCurrencies(raw);
    const next = {
      cp: before.cp + add.cp,
      sp: before.sp + add.sp,
      ep: before.ep + add.ep,
      gp: before.gp + add.gp,
      pp: before.pp + add.pp,
    };
    const updateId = Number(raw.updateId ?? raw.revision ?? 0);
    const attempts: Array<{ url: string; method: string; body: Record<string, unknown> }> = [];
    if (add.gp !== 0 && add.cp + add.sp + add.ep + add.pp === 0) {
      attempts.push({ url: GOLD_URL, method: 'PUT', body: { characterId, amount: next.gp } });
    }
    attempts.push({ url: CURRENCY_URL, method: 'PUT', body: { characterId, ...next } });
    attempts.push({
      url: CURRENCY_URL,
      method: 'PUT',
      body: {
        characterId,
        currencies: next,
        ...(Number.isFinite(updateId) && updateId > 0 ? { updateId } : {}),
      },
    });
    attempts.push({ url: GOLD_URL, method: 'PUT', body: { characterId, amount: next.gp, gp: next.gp } });

    for (const attempt of attempts) {
      const ok = await ddbAuthedOk(cobalt, characterId, attempt.url, {
        method: attempt.method,
        body: JSON.stringify(attempt.body),
      });
      if (!ok) continue;
      try {
        const after = readCurrencies(await fetchRawCharacter(cobalt, characterId));
        if (after.gp >= next.gp && after.pp >= next.pp && after.sp >= next.sp) {
          console.info(`[DDB] coins +${JSON.stringify(add)} for character ${characterId} via ${attempt.url}`);
          return { ok: true };
        }
        console.warn(`[DDB] coin PUT 200 but pouch unchanged for ${characterId} (${attempt.url})`);
      } catch {
        console.info(`[DDB] coins PUT ok (unverified) for character ${characterId}`);
        return { ok: true };
      }
    }
    return { ok: false, error: 'D&D Beyond did not save coins on this sheet' };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Currency push failed';
    console.warn('[DDB] currency push error:', error);
    return { ok: false, error };
  }
}

export async function pushGoldDeltaToDdb(
  cobalt: string,
  characterId: number,
  gpDelta: number,
): Promise<boolean> {
  const result = await pushCurrencyDeltaToDdb(cobalt, characterId, { gp: gpDelta });
  return result.ok;
}
