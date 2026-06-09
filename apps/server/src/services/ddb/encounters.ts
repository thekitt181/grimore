import type { DdbEncounter, DdbEncounterMonster } from '@grimoire/shared';
import { cobaltCacheId, getBearerToken } from './cobaltAuth';

/** Fetch encounters from a DDB campaign (best-effort unofficial endpoint). */
export async function fetchDdbEncounters(
  cobalt: string,
  ddbCampaignId: number,
): Promise<DdbEncounter[]> {
  const cacheId = cobaltCacheId(cobalt);
  const bearer = await getBearerToken(cacheId, cobalt);
  if (!bearer) throw new Error('Invalid or expired D&D Beyond session');

  const url = `https://www.dndbeyond.com/api/campaign/${ddbCampaignId}/encounters`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${bearer}`,
      Cookie: `CobaltSession=${cobalt}`,
      Accept: 'application/json',
      'User-Agent': 'GrimoireVTT/1.0',
    },
  });

  if (!res.ok) return [];

  const json = (await res.json()) as {
    data?: Array<{
      id: number | string;
      name: string;
      monsters?: Array<{
        monsterId?: number;
        name: string;
        challengeRating?: string;
        hitPoints?: number;
        armorClass?: number;
        quantity?: number;
      }>;
    }>;
  };

  return (json.data ?? []).map((enc) => ({
    id: String(enc.id),
    name: enc.name,
    monsters: (enc.monsters ?? []).map(
      (m): DdbEncounterMonster => ({
        ddbMonsterId: m.monsterId,
        name: m.name,
        cr: m.challengeRating,
        hp: m.hitPoints,
        ac: m.armorClass,
        count: m.quantity ?? 1,
      }),
    ),
  }));
}
