import type { DdbEncounter, DdbEncounterMonster } from '@grimoire/shared';
import { authHeaders, getDdbAuthContext, type DdbAuthContext } from './ddbAuthContext';
import { DDB_URLS } from './config';

const LEGACY_CAMPAIGN_ENCOUNTER_URLS = (campaignId: number): string[] => [
  `https://www.dndbeyond.com/api/campaign/stt/active-encounters/${campaignId}`,
  `https://www.dndbeyond.com/api/campaign/stt/encounters/${campaignId}`,
  `https://www.dndbeyond.com/api/campaign/${campaignId}/encounters`,
];

const LEGACY_SINGLE_ENCOUNTER_URLS = (encounterId: string): string[] => [
  `https://www.dndbeyond.com/api/encounter/${encounterId}`,
  `https://www.dndbeyond.com/api/encounters/${encounterId}`,
  `https://www.dndbeyond.com/api/encounter-builder/encounter/${encounterId}`,
];

const UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

type RawMonster = {
  monsterId?: number;
  creatureId?: number;
  entityId?: number;
  id?: number;
  name?: string;
  challengeRating?: string;
  cr?: string;
  hitPoints?: number;
  hp?: number;
  maximumHitPoints?: number;
  currentHitPoints?: number;
  armorClass?: number;
  ac?: number;
  quantity?: number;
  count?: number;
  definition?: RawMonster;
  monster?: RawMonster;
  creature?: RawMonster;
};

type RawEncounter = {
  id?: number | string;
  encounterId?: number | string;
  name?: string | null;
  title?: string | null;
  campaignId?: number;
  campaign?: { id?: number; campaignId?: number; name?: string };
  monsters?: RawMonster[];
  creatures?: RawMonster[];
  combatants?: RawMonster[];
  groups?: Array<{ name?: string | null; creatures?: RawMonster[]; monsters?: RawMonster[] }>;
  description?: string | null;
  flavorText?: string | null;
  notes?: string | null;
  rewards?: string | null;
};

function encounterHeaders(ctx: DdbAuthContext, encounterId?: string): Record<string, string> {
  const referer = encounterId
    ? `https://www.dndbeyond.com/encounters/${encounterId}`
    : 'https://www.dndbeyond.com/my-encounters';
  return {
    ...authHeaders(ctx),
    Referer: referer,
    Origin: 'https://www.dndbeyond.com',
  };
}

function flattenMonsters(raw: RawEncounter): RawMonster[] {
  const rows: RawMonster[] = [
    ...(raw.monsters ?? []),
    ...(raw.creatures ?? []),
    ...(raw.combatants ?? []),
  ];
  for (const group of raw.groups ?? []) {
    rows.push(...(group.creatures ?? []), ...(group.monsters ?? []));
  }
  return rows;
}

function parseMonster(raw: RawMonster): DdbEncounterMonster | null {
  const nested = raw.definition ?? raw.monster ?? raw.creature;
  const source = nested && typeof nested === 'object' ? { ...nested, ...raw } : raw;
  const name = source.name?.trim();
  if (!name) return null;
  const ddbMonsterId = source.monsterId ?? source.creatureId ?? source.entityId ?? source.id;
  return {
    ...(ddbMonsterId ? { ddbMonsterId } : {}),
    name,
    cr: source.challengeRating ?? source.cr,
    hp: source.hitPoints ?? source.hp ?? source.maximumHitPoints ?? source.currentHitPoints,
    ac: source.armorClass ?? source.ac,
    count: Math.max(1, raw.quantity ?? raw.count ?? source.quantity ?? source.count ?? 1),
  };
}

function nameFromMonsters(monsters: DdbEncounterMonster[]): string | null {
  if (monsters.length === 0) return null;
  const parts = monsters.map((m) => (m.count > 1 ? `${m.count}× ${m.name}` : m.name));
  if (parts.length <= 3) return parts.join(', ');
  return `${parts.slice(0, 2).join(', ')} +${parts.length - 2} more`;
}

function encounterDisplayName(raw: RawEncounter, monsters: DdbEncounterMonster[]): string {
  for (const field of [raw.name, raw.title, raw.description, raw.flavorText, raw.notes, raw.rewards]) {
    const text = field?.trim();
    if (text) return text;
  }

  for (const group of raw.groups ?? []) {
    const groupName = group.name?.trim();
    if (groupName) return groupName;
  }

  const fromMonsters = nameFromMonsters(monsters);
  if (fromMonsters) return fromMonsters;

  const id = raw.id ?? raw.encounterId;
  if (id != null) return `Encounter ${String(id).slice(0, 8)}…`;
  return 'Encounter';
}

function rawCampaignId(raw: RawEncounter): number | null {
  const id = raw.campaignId ?? raw.campaign?.id ?? raw.campaign?.campaignId;
  return typeof id === 'number' && Number.isFinite(id) ? id : null;
}

function parseEncounter(raw: RawEncounter): DdbEncounter | null {
  const id = raw.id ?? raw.encounterId;
  if (id == null) return null;

  const monsters = flattenMonsters(raw)
    .map(parseMonster)
    .filter((m): m is DdbEncounterMonster => m !== null);

  return { id: String(id), name: encounterDisplayName(raw, monsters), monsters };
}

function extractEncounterArray(json: unknown): RawEncounter[] {
  if (!json || typeof json !== 'object') return [];

  const root = json as Record<string, unknown>;

  if (Array.isArray(root)) return root as RawEncounter[];

  const data = root['data'];
  if (Array.isArray(data)) return data as RawEncounter[];

  if (data && typeof data === 'object') {
    const nested = data as Record<string, unknown>;
    for (const key of ['encounters', 'items', 'results']) {
      const arr = nested[key];
      if (Array.isArray(arr)) return arr as RawEncounter[];
    }
    return [data as RawEncounter];
  }

  if (root['encounters'] && Array.isArray(root['encounters'])) {
    return root['encounters'] as RawEncounter[];
  }

  if (root['id'] != null || root['encounterId'] != null) {
    return [root as RawEncounter];
  }

  return [];
}

function parseEncounterList(json: unknown, campaignId?: number): DdbEncounter[] {
  return extractEncounterArray(json)
    .filter((raw) => {
      if (!campaignId) return true;
      const rawId = rawCampaignId(raw);
      return rawId == null || rawId === campaignId;
    })
    .map(parseEncounter)
    .filter((enc): enc is DdbEncounter => enc !== null);
}

async function fetchJson(url: string, headers: Record<string, string>): Promise<unknown | null> {
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) {
      console.warn(`[DDB] Encounters ${url} → ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn(`[DDB] Encounters ${url} failed:`, err);
    return null;
  }
}

/** Parse encounter id from DDB URL, UUID, or raw numeric id. */
export function parseDdbEncounterId(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const uuidMatch = trimmed.match(UUID_RE);
  if (uuidMatch) return uuidMatch[0].toLowerCase();

  const patterns = [
    /encounters?\/([0-9a-f-]{36})/i,
    /encounters?\/(\d+)/i,
    /encounter-builder\/([0-9a-f-]{36})/i,
    /encounter-builder\/(\d+)/i,
    /\/e\/([0-9a-f-]{36})/i,
    /\/e\/(\d+)/i,
  ];
  for (const re of patterns) {
    const m = trimmed.match(re);
    if (m?.[1]) {
      const id = m[1];
      if (UUID_RE.test(id)) return id.toLowerCase();
      const numeric = parseInt(id, 10);
      if (Number.isFinite(numeric) && numeric > 0) return String(numeric);
    }
  }

  const numeric = parseInt(trimmed, 10);
  return Number.isFinite(numeric) && numeric > 0 ? String(numeric) : null;
}

async function fetchFromEncounterService(
  ctx: DdbAuthContext,
  encounterId: string,
): Promise<DdbEncounter | null> {
  const headers = encounterHeaders(ctx, encounterId);
  const json = await fetchJson(DDB_URLS.encounterById(encounterId), headers);
  if (!json) return null;
  const list = parseEncounterList(json);
  const match = list.find((e) => e.id.toLowerCase() === encounterId.toLowerCase()) ?? list[0];
  if (match) return match;

  if (json && typeof json === 'object') {
    const data = (json as Record<string, unknown>).data;
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      return parseEncounter(data as RawEncounter);
    }
  }

  return null;
}

async function fetchEncounterServiceList(
  ctx: DdbAuthContext,
  ddbCampaignId?: number,
): Promise<DdbEncounter[]> {
  const headers = encounterHeaders(ctx);
  const json = await fetchJson(DDB_URLS.encounterList(), headers);
  if (!json) return [];
  return parseEncounterList(json, ddbCampaignId);
}

/** Fetch encounters saved on a DDB account (optionally filtered to one campaign). */
export async function fetchDdbEncounters(
  cobalt: string,
  ddbCampaignId: number,
): Promise<DdbEncounter[]> {
  const ctx = await getDdbAuthContext(cobalt);
  if (!ctx) throw new Error('Invalid or expired D&D Beyond session');

  const fromService = await fetchEncounterServiceList(ctx, ddbCampaignId);
  if (fromService.length > 0) return fromService;

  const headers = authHeaders(ctx);
  for (const url of LEGACY_CAMPAIGN_ENCOUNTER_URLS(ddbCampaignId)) {
    const json = await fetchJson(url, headers);
    if (!json) continue;
    const list = parseEncounterList(json, ddbCampaignId);
    if (list.length > 0) return list;
  }

  return [];
}

/** Fetch a single encounter from the Encounter Builder by UUID or legacy id. */
export async function fetchDdbEncounterById(
  cobalt: string,
  encounterId: string,
): Promise<DdbEncounter | null> {
  const ctx = await getDdbAuthContext(cobalt);
  if (!ctx) throw new Error('Invalid or expired D&D Beyond session');

  const normalizedId = encounterId.toLowerCase();
  if (UUID_RE.test(encounterId)) {
    const fromService = await fetchFromEncounterService(ctx, normalizedId);
    if (fromService) return fromService;
  }

  const headers = authHeaders(ctx);
  for (const url of LEGACY_SINGLE_ENCOUNTER_URLS(encounterId)) {
    const json = await fetchJson(url, headers);
    if (!json) continue;
    const list = parseEncounterList(json);
    const match =
      list.find((e) => e.id.toLowerCase() === normalizedId) ?? list[0];
    if (match) return match;
  }

  if (!UUID_RE.test(encounterId)) {
    return fetchFromEncounterService(ctx, encounterId);
  }

  return null;
}

export async function resolveDdbEncounter(
  cobalt: string,
  encounterRef: string,
  ddbCampaignId?: number,
): Promise<DdbEncounter | null> {
  const parsedId = parseDdbEncounterId(encounterRef);
  if (parsedId) {
    const direct = await fetchDdbEncounterById(cobalt, parsedId);
    if (direct) return direct;
  }

  if (ddbCampaignId) {
    const list = await fetchDdbEncounters(cobalt, ddbCampaignId);
    const needle = (parsedId ?? encounterRef.trim()).toLowerCase();
    return list.find((e) => e.id.toLowerCase() === needle) ?? null;
  }

  const ctx = await getDdbAuthContext(cobalt);
  if (!ctx) return null;
  const all = await fetchEncounterServiceList(ctx);
  if (all.length === 0) return null;
  const needle = (parsedId ?? encounterRef.trim()).toLowerCase();
  return all.find((e) => e.id.toLowerCase() === needle || e.name.toLowerCase() === needle) ?? null;
}
