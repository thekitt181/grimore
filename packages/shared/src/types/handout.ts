export type HandoutType = 'TEXT' | 'IMAGE' | 'MAP_FRAGMENT' | 'ITEM_CARD';

export type HandoutInventoryTarget = 'character' | 'party';

export interface HandoutItemMeta {
  name?: string;
  itemType?: string;
  rarity?: string;
  source?: string;
  isCustom?: boolean;
  compendiumItemId?: string;
  ddbDefinitionId?: number;
  /** Scene map handout item id — links persisted handouts to canvas tokens. */
  sceneItemId?: string;
}

export interface HandoutRecord {
  id: string;
  campaignId: string;
  title: string;
  content: string | null;
  imageUrl: string | null;
  type: HandoutType;
  compendiumItemId: string | null;
  ddbDefinitionId: number | null;
  itemMeta: HandoutItemMeta | null;
  createdAt: string;
  updatedAt: string;
}

export interface HandoutReceiptRecord {
  id: string;
  handoutId: string;
  userId: string;
  sessionId: string | null;
  title: string;
  content: string | null;
  imageUrl: string | null;
  type: HandoutType;
  itemMeta: HandoutItemMeta | null;
  compendiumItemId: string | null;
  ddbDefinitionId: number | null;
  receivedAt: string;
}
