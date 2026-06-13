import type { DdbCampaignSummary, DdbCharacterSummary } from '@grimoire/shared';
import { cobaltCacheId, ddbAuthHeaders, getBearerToken, normalizeCobaltToken } from './cobaltAuth';
import { DDB_URLS } from './config';

interface CampaignStub {
  id: number;
  name: string;
}

interface ShortCampaignCharacter {
  id?: number;
  characterId?: number;
  name?: string;
  characterName?: string;
  userId?: number;
  userName?: string;
  avatarUrl?: string;
  level?: number;
  className?: string;
  classByLine?: string;
  classDescription?: string;
}

interface OwnedCharacterRow {
  id?: number;
  characterId?: number;
  name?: string;
  characterName?: string;
  avatarUrl?: string;
  level?: number;
  className?: string;
  classByLine?: string;
  classDescription?: string;
  campaignId?: number;
  campaignName?: string;
}

function classLabelFromRow(ch: {
  classByLine?: string;
  classDescription?: string;
  className?: string;
}): string {
  return ch.classByLine ?? ch.classDescription ?? ch.className ?? 'Adventurer';
}

function ddbSiteHeaders(cobalt: string, bearer: string): Record<string, string> {
  return ddbAuthHeaders(cobalt, bearer);
}

function characterServiceHeaders(cobalt: string, bearer: string): Record<string, string> {
  return {
    ...ddbAuthHeaders(cobalt, bearer),
    'Content-Type': 'application/json',
  };
}

/** Extract DDB user id from bearer JWT payload (best-effort). */
export function userIdFromBearer(bearer: string): number | null {
  try {
    const part = bearer.split('.')[1];
    if (!part) return null;
    const padded = part.replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as Record<string, unknown>;

    const nameIdClaim =
      json['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier'];
    const candidates = [
      json['userId'],
      json['UserId'],
      json['sub'],
      json['id'],
      nameIdClaim,
    ];
    for (const c of candidates) {
      const n = typeof c === 'string' ? parseInt(c, 10) : typeof c === 'number' ? c : NaN;
      if (Number.isFinite(n) && n > 0) return n;
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchCampaignStubs(cobalt: string, bearer: string): Promise<CampaignStub[]> {
  const headers = ddbSiteHeaders(cobalt, bearer);
  const seen = new Map<number, CampaignStub>();

  for (const url of [DDB_URLS.activeCampaigns, DDB_URLS.userCampaigns]) {
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) continue;
      const json = (await res.json()) as { status?: string; data?: CampaignStub[] };
      if (json.status !== 'success' || !Array.isArray(json.data)) continue;
      for (const c of json.data) {
        if (c?.id && c?.name) seen.set(c.id, { id: c.id, name: c.name });
      }
    } catch {
      // try next endpoint
    }
  }

  return [...seen.values()];
}

async function fetchCampaignRoster(
  cobalt: string,
  bearer: string,
  campaign: CampaignStub,
): Promise<DdbCharacterSummary[]> {
  const headers = ddbSiteHeaders(cobalt, bearer);
  const res = await fetch(DDB_URLS.campaignCharacters(campaign.id), { headers });
  if (!res.ok) return [];

  const json = (await res.json()) as { status?: string; data?: ShortCampaignCharacter[] };
  const rows = json.status === 'success' && Array.isArray(json.data) ? json.data : [];

  return rows
    .map((ch): DdbCharacterSummary | null => {
      const id = ch.id ?? ch.characterId;
      const name = ch.name ?? ch.characterName;
      if (!id || !name) return null;
      return {
        ddbCharacterId: id,
        name,
        level: ch.level ?? 1,
        classLabel: classLabelFromRow(ch),
        avatarUrl: ch.avatarUrl,
        campaignId: campaign.id,
        campaignName: campaign.name,
        isCampaignCharacter: true,
      };
    })
    .filter((x): x is DdbCharacterSummary => x !== null);
}

async function fetchOwnedCharacterList(
  cobalt: string,
  bearer: string,
  userId: number,
): Promise<DdbCharacterSummary[]> {
  const res = await fetch(DDB_URLS.ownedCharacters(userId), {
    headers: characterServiceHeaders(cobalt, bearer),
  });
  if (!res.ok) return [];

  const json = (await res.json()) as {
    success?: boolean;
    data?: OwnedCharacterRow[] | { characters?: OwnedCharacterRow[] };
  };

  let rows: OwnedCharacterRow[] = [];
  if (json.success && Array.isArray(json.data)) {
    rows = json.data;
  } else if (json.success && json.data && typeof json.data === 'object' && 'characters' in json.data) {
    rows = (json.data as { characters?: OwnedCharacterRow[] }).characters ?? [];
  }

  return rows
    .map((ch): DdbCharacterSummary | null => {
      const id = ch.id ?? ch.characterId;
      const name = ch.name ?? ch.characterName;
      if (!id || !name) return null;
      return {
        ddbCharacterId: id,
        name,
        level: ch.level ?? 1,
        classLabel: classLabelFromRow(ch),
        avatarUrl: ch.avatarUrl,
        campaignId: ch.campaignId,
        campaignName: ch.campaignName,
        isOwned: true,
      };
    })
    .filter((x): x is DdbCharacterSummary => x !== null);
}

/** Legacy inline characters on user-campaigns payload (older DDB shape). */
function parseLegacyInlineCharacters(
  cobalt: string,
  bearer: string,
): Promise<DdbCharacterSummary[]> {
  return fetch(DDB_URLS.userCampaigns, { headers: ddbSiteHeaders(cobalt, bearer) })
    .then(async (res) => {
      if (!res.ok) return [];
      const json = (await res.json()) as {
        status?: string;
        data?: Array<{
          id: number;
          name: string;
          characters?: ShortCampaignCharacter[];
        }>;
      };
      if (json.status !== 'success' || !json.data) return [];

      const out: DdbCharacterSummary[] = [];
      for (const campaign of json.data) {
        for (const ch of campaign.characters ?? []) {
          const id = ch.id ?? ch.characterId;
          const name = ch.name ?? ch.characterName;
          if (!id || !name) continue;
          out.push({
            ddbCharacterId: id,
            name,
            level: ch.level ?? 1,
            classLabel: classLabelFromRow(ch),
            avatarUrl: ch.avatarUrl,
            campaignId: campaign.id,
            campaignName: campaign.name,
            isCampaignCharacter: true,
          });
        }
      }
      return out;
    })
    .catch(() => []);
}

function mergeCharacterLists(lists: DdbCharacterSummary[][]): DdbCharacterSummary[] {
  const byId = new Map<number, DdbCharacterSummary>();
  for (const list of lists) {
    for (const ch of list) {
      const existing = byId.get(ch.ddbCharacterId);
      if (!existing) {
        byId.set(ch.ddbCharacterId, ch);
        continue;
      }
      byId.set(ch.ddbCharacterId, {
        ...existing,
        ...ch,
        level: Math.max(ch.level ?? 1, existing.level ?? 1),
        campaignName: ch.campaignName ?? existing.campaignName,
        avatarUrl: ch.avatarUrl ?? existing.avatarUrl,
        classLabel:
          ch.classLabel !== 'Adventurer' ? ch.classLabel : existing.classLabel,
        isOwned: Boolean(existing.isOwned || ch.isOwned),
        isCampaignCharacter: Boolean(existing.isCampaignCharacter || ch.isCampaignCharacter),
      });
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function fetchDdbCampaigns(cobalt: string): Promise<DdbCampaignSummary[]> {
  const token = normalizeCobaltToken(cobalt);
  const cacheId = cobaltCacheId(token);
  const bearer = await getBearerToken(cacheId, token);
  if (!bearer) throw new Error('Invalid or expired D&D Beyond session');

  const campaigns = await fetchCampaignStubs(token, bearer);
  const counts = await Promise.all(
    campaigns.map(async (c) => {
      const roster = await fetchCampaignRoster(token, bearer, c);
      return roster.length;
    }),
  );

  return campaigns.map((c, i) => ({
    ddbCampaignId: c.id,
    name: c.name,
    characterCount: counts[i] ?? 0,
  }));
}

export async function fetchDdbCharacterList(cobalt: string): Promise<DdbCharacterSummary[]> {
  const token = normalizeCobaltToken(cobalt);
  const cacheId = cobaltCacheId(token);
  const bearer = await getBearerToken(cacheId, token);
  if (!bearer) throw new Error('Invalid or expired D&D Beyond session');

  const lists: DdbCharacterSummary[][] = [];

  const campaigns = await fetchCampaignStubs(token, bearer);
  const rosterLists = await Promise.all(
    campaigns.map((c) => fetchCampaignRoster(token, bearer, c)),
  );
  lists.push(...rosterLists);

  lists.push(await parseLegacyInlineCharacters(token, bearer));

  const userId = userIdFromBearer(bearer);
  if (userId) {
    lists.push(await fetchOwnedCharacterList(token, bearer, userId));
  }

  return mergeCharacterLists(lists);
}
