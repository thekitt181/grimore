import type { DdbSourceSummary } from '@grimoire/shared';
import { DDB_URLS } from './config';
import { authHeaders, type DdbAuthContext } from './ddbAuthContext';
import { stripDdbHtml } from './ddbHtml';

function pickSourceName(raw: Record<string, unknown>): string {
  const description = stripDdbHtml(raw.description ?? raw.sourceName ?? '');
  if (description) return description;
  return String(
    raw.name
    ?? raw.label
    ?? raw.title
    ?? raw.shortName
    ?? '',
  ).trim();
}

function pickSourceId(raw: Record<string, unknown>): number | null {
  const id = Number(raw.id ?? raw.sourceId ?? raw.sourceCategoryId);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function normalizeSource(raw: unknown): DdbSourceSummary | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const id = pickSourceId(obj);
  const name = pickSourceName(obj);
  if (!id || !name) return null;
  const category = String(obj.categoryName ?? obj.category ?? obj.type ?? '').trim() || undefined;
  const accessType = String(obj.accessType ?? obj.ownership ?? obj.ownershipType ?? '').trim() || undefined;
  return {
    id,
    name,
    ...(category ? { category } : {}),
    ...(accessType ? { accessType } : {}),
    isEnabled: obj.isEnabled !== false,
  };
}

/** Book/module sources only — do not merge sourceCategories (they reuse ids, e.g. 8 = Eberron vs LMoP). */
function collectSources(json: Record<string, unknown>): DdbSourceSummary[] {
  const buckets: unknown[] = [];
  if (Array.isArray(json.sources)) buckets.push(...json.sources);
  const data = json.data;
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    if (Array.isArray(d.sources)) buckets.push(...d.sources);
  }

  const out = new Map<number, DdbSourceSummary>();
  for (const entry of buckets) {
    const normalized = normalizeSource(entry);
    if (!normalized) continue;
    out.set(normalized.id, normalized);
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export type DdbSourceNameMap = Map<number, string>;
export type DdbChallengeRatingMap = Map<number, number>;
export type DdbChallengeRatingXpMap = Map<number, number>;
export type DdbIdNameMap = Map<number, string>;

export interface DdbCatalog {
  sourceNames: DdbSourceNameMap;
  challengeRatingById: DdbChallengeRatingMap;
  challengeRatingXpById: DdbChallengeRatingXpMap;
  monsterTypes: DdbIdNameMap;
  alignments: DdbIdNameMap;
  senses: DdbIdNameMap;
  movements: DdbIdNameMap;
}

export function buildSourceNameMap(sources: DdbSourceSummary[]): DdbSourceNameMap {
  const map = new Map<number, string>();
  for (const source of sources) map.set(source.id, source.name);
  return map;
}

function buildChallengeRatingMap(json: Record<string, unknown>): {
  values: DdbChallengeRatingMap;
  xp: DdbChallengeRatingXpMap;
} {
  const list = Array.isArray(json.challengeRatings) ? json.challengeRatings : [];
  const values = new Map<number, number>();
  const xp = new Map<number, number>();
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const o = entry as Record<string, unknown>;
    const id = Number(o.id);
    const value = Number(o.value);
    if (Number.isFinite(id) && id > 0 && Number.isFinite(value)) {
      values.set(id, value);
      const xpVal = Number(o.xp);
      if (Number.isFinite(xpVal) && xpVal > 0) xp.set(id, xpVal);
    }
  }
  return { values, xp };
}

function buildIdNameMap(json: Record<string, unknown>, key: string): DdbIdNameMap {
  const list = Array.isArray(json[key]) ? json[key] as unknown[] : [];
  const map = new Map<number, string>();
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const o = entry as Record<string, unknown>;
    const id = Number(o.id);
    const name = String(o.name ?? '').trim();
    if (Number.isFinite(id) && id > 0 && name) map.set(id, name);
  }
  return map;
}

export function formatChallengeRatingValue(value: number): string {
  if (value === 0.125) return '1/8';
  if (value === 0.25) return '1/4';
  if (value === 0.5) return '1/2';
  if (Number.isInteger(value)) return String(value);
  return String(value);
}

function pickPrimaryMonsterSourceId(raw: Record<string, unknown>): number | undefined {
  const top = Number(raw.sourceId);
  if (Number.isFinite(top) && top > 0) return top;

  const sources = raw.sources;
  if (!Array.isArray(sources)) return undefined;

  for (const entry of sources) {
    if (!entry || typeof entry !== 'object') continue;
    const o = entry as Record<string, unknown>;
    if (Number(o.sourceType) === 1) {
      const sid = Number(o.sourceId ?? o.id);
      if (Number.isFinite(sid) && sid > 0) return sid;
    }
  }

  for (const entry of sources) {
    if (!entry || typeof entry !== 'object') continue;
    const sid = Number((entry as Record<string, unknown>).sourceId ?? (entry as Record<string, unknown>).id);
    if (Number.isFinite(sid) && sid > 0) return sid;
  }

  return undefined;
}

/** Primary publication book for a monster (e.g. Lost Mine of Phandelver). */
export function resolveMonsterSourceLabel(
  raw: Record<string, unknown>,
  catalog: DdbSourceNameMap,
  preferredSourceId?: number,
): string {
  if (preferredSourceId != null && catalog.has(preferredSourceId)) {
    return catalog.get(preferredSourceId)!;
  }
  const resolved = resolveDdbSourceLabel(raw, catalog, preferredSourceId);
  if (resolved !== 'D&D Beyond') return resolved;
  const sourceId = preferredSourceId ?? pickPrimaryMonsterSourceId(raw);
  if (sourceId != null && catalog.has(sourceId)) {
    return catalog.get(sourceId)!;
  }
  return 'D&D Beyond';
}

function matchCatalogName(label: string, catalog: DdbSourceNameMap): string | null {
  const lower = label.toLowerCase();
  for (const name of catalog.values()) {
    if (name.toLowerCase() === lower) return name;
  }
  for (const name of catalog.values()) {
    const abbrev = name
      .split(/\s+/)
      .map((w) => w[0] ?? '')
      .join('')
      .toLowerCase();
    if (abbrev.length >= 2 && abbrev === lower) return name;
  }
  return null;
}

/** Map DDB entity source metadata to full compendium book name(s). */
export function resolveDdbSourceLabel(
  raw: Record<string, unknown>,
  catalog: DdbSourceNameMap,
  preferredSourceId?: number,
): string {
  if (preferredSourceId != null && catalog.has(preferredSourceId)) {
    return catalog.get(preferredSourceId)!;
  }

  const def = (raw.definition ?? raw) as Record<string, unknown>;
  const names: string[] = [];

  for (const bucket of [raw.sources, def.sources, raw.sourceIds, def.sourceIds]) {
    if (!Array.isArray(bucket)) continue;
    for (const entry of bucket) {
      if (!entry || typeof entry !== 'object') continue;
      const o = entry as Record<string, unknown>;
      const sid = Number(o.sourceId ?? o.id);
      if (Number.isFinite(sid) && sid > 0 && catalog.has(sid)) {
        names.push(catalog.get(sid)!);
        continue;
      }
      const shortLabel = String(o.sourceName ?? o.name ?? o.label ?? '').trim();
      if (!shortLabel) continue;
      names.push(matchCatalogName(shortLabel, catalog) ?? shortLabel);
    }
  }

  if (names.length > 0) return [...new Set(names)].join(', ');
  return 'D&D Beyond';
}

export async function fetchDdbSources(ctx: DdbAuthContext): Promise<DdbSourceSummary[]> {
  const catalog = await fetchDdbCatalog(ctx);
  return catalog.sourceList;
}

export async function fetchDdbCatalog(ctx: DdbAuthContext): Promise<DdbCatalog & { sourceList: DdbSourceSummary[] }> {
  const res = await fetch(DDB_URLS.configJson, {
    headers: {
      ...authHeaders(ctx),
      Accept: '*/*',
      'User-Agent': 'Foundry VTT Character Integrator',
    },
  });
  if (!res.ok) {
    throw new Error(`DDB config request failed (${res.status})`);
  }
  const json = (await res.json()) as Record<string, unknown>;
  const sourceList = collectSources(json);
  const challengeRatings = buildChallengeRatingMap(json);
  return {
    sourceList,
    sourceNames: buildSourceNameMap(sourceList),
    challengeRatingById: challengeRatings.values,
    challengeRatingXpById: challengeRatings.xp,
    monsterTypes: buildIdNameMap(json, 'monsterTypes'),
    alignments: buildIdNameMap(json, 'alignments'),
    senses: buildIdNameMap(json, 'senses'),
    movements: buildIdNameMap(json, 'movements'),
  };
}
