export const DDB_URLS = {
  authService: 'https://auth-service.dndbeyond.com/v1/cobalt-token',
  characterBase: 'https://character-service.dndbeyond.com/character/v5',
  userCampaigns: 'https://www.dndbeyond.com/api/campaign/stt/user-campaigns',
  activeCampaigns: 'https://www.dndbeyond.com/api/campaign/stt/active-campaigns',
  campaignCharacters: (campaignId: number) =>
    `https://www.dndbeyond.com/api/campaign/stt/active-characters/${campaignId}`,
  ownedCharacters: (userId: number) =>
    `https://character-service.dndbeyond.com/character/v5/characters/list?userId=${userId}`,
  monsterBase: 'https://monster-service.dndbeyond.com/v1/Monster',
  configJson: 'https://www.dndbeyond.com/api/config/json',
  characterPage: 'https://www.dndbeyond.com/characters',
  gameDataSpells: (classId: number, classLevel: number, campaignId?: number) => {
    const campaign = campaignId ? `&campaignId=${campaignId}` : '';
    return `${DDB_URLS.characterBase}/game-data/spells?classId=${classId}&classLevel=${classLevel}&sharingSetting=2${campaign}`;
  },
  gameDataItems: (campaignId?: number) => {
    const campaign = campaignId ? `&campaignId=${campaignId}` : '';
    return `${DDB_URLS.characterBase}/game-data/items?sharingSetting=2${campaign}`;
  },
  gameDataAlwaysKnownSpells: (classId: number, classLevel: number, campaignId?: number) => {
    const campaign = campaignId ? `&campaignId=${campaignId}` : '';
    return `${DDB_URLS.characterBase}/game-data/always-known-spells?classId=${classId}&classLevel=${classLevel}&sharingSetting=2${campaign}`;
  },
  gameDataAlwaysPreparedSpells: (classId: number, classLevel: number, campaignId?: number) => {
    const campaign = campaignId ? `&campaignId=${campaignId}` : '';
    return `${DDB_URLS.characterBase}/game-data/always-prepared-spells?classId=${classId}&classLevel=${classLevel}&sharingSetting=2${campaign}`;
  },
  monstersByIds: (ids: number[]) => {
    const query = ids.map((id) => `ids=${id}`).join('&');
    return `${DDB_URLS.monsterBase}?${query}`;
  },
  monstersSearch: (
    skip: number,
    take: number,
    search: string,
    opts?: { homebrew?: boolean; homebrewOnly?: boolean; sourceIds?: number[] },
  ) => {
    const homebrew =
      opts?.homebrewOnly ? '&showHomebrew=t' : opts?.homebrew !== false ? '' : '&showHomebrew=f';
    const sources = (opts?.sourceIds ?? []).map((id) => `&sources=${id}`).join('');
    return `${DDB_URLS.monsterBase}?search=${encodeURIComponent(search)}&skip=${skip}&take=${take}${homebrew}${sources}`;
  },
  monsterById: (id: number) => `${DDB_URLS.monsterBase}/${id}`,
} as const;

/** Class ids for spell game-data API (level 20 fetch). */
export const DDB_SPELL_CLASS_IDS = [
  { name: 'Bard', id: 1 },
  { name: 'Cleric', id: 2 },
  { name: 'Druid', id: 3 },
  { name: 'Paladin', id: 4 },
  { name: 'Ranger', id: 5 },
  { name: 'Sorcerer', id: 6 },
  { name: 'Warlock', id: 7 },
  { name: 'Wizard', id: 8 },
  { name: 'Barbarian', id: 9 },
  { name: 'Fighter', id: 10 },
  { name: 'Monk', id: 11 },
  { name: 'Rogue', id: 12 },
  { name: 'Artificer', id: 252717 },
] as const;

export function characterUrl(characterId: number): string {
  return `${DDB_URLS.characterBase}/character/${characterId}?includeCustomItems=true`;
}
